# Integrating the Hedera HCS proof rail into the BoA frontend

Goal: a "live" visual demo where clicking a button in **your existing frontend** emits a
**router-signed usage receipt** to **Hedera Consensus Service**, animates the 5 steps
(meter → sign → submit → verify), and shows the message land on-chain (HashScan) plus a
growing append-only audit log.

Architecture: **two pieces**, connected by a small HTTP API.

```
Your frontend (existing app)            BoA Hedera API (new Railway service)        Hedera testnet
────────────────────────────            ────────────────────────────────────       ──────────────
 <HederaReceiptDemo/> component  ──▶  POST /api/receipts/emit  (or SSE stream)
   button "Emit receipt"               1 build receipt
   5-step pipeline UI                  2 router-sign  (keys live HERE, server-side)
   audit-log table          ◀── SSE ── 3 submit to ONE persistent topic ──gRPC──▶ append (seq#)
                                        4 poll mirror node ───────────HTTPS──────▶ read back
                                        5 return verified payload + hashscan url
```

> **The one hard rule:** the operator key and router key live **only** on the API
> service (Railway env vars). They are never shipped to the browser. The frontend only
> ever calls the API.

---

## Part A — the BoA Hedera API service (deploy on Railway)

This reuses `spikes/hedera/src/receipt.ts` (already in this repo). Deploy **this
`spikes/hedera` folder** as a Railway service (set the service root / working directory
to `spikes/hedera`).

### A1. Add dependencies

```bash
cd spikes/hedera
npm i express cors
npm i -D @types/express @types/cors
```

### A2. Add the server — `spikes/hedera/src/server.ts`

```ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import {
  Client, PrivateKey, TopicCreateTransaction, TopicMessageSubmitTransaction, TopicId,
} from "@hashgraph/sdk";
import { ethers } from "ethers";
import {
  sampleUnsignedReceipt, signReceipt, verifyReceipt, canonicalJSON, receiptDigest,
  type UnsignedReceipt, type UsageReceipt,
} from "./receipt";

const MIRROR = process.env.HEDERA_MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";
const PORT = Number(process.env.PORT ?? 8080);
const ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";   // set to your frontend URL in prod

function parseKey(raw: string, type: string): PrivateKey {
  try { return type.toUpperCase() === "ECDSA" ? PrivateKey.fromStringECDSA(raw) : PrivateKey.fromStringED25519(raw); }
  catch { return PrivateKey.fromStringDer(raw); }
}

const operatorId  = process.env.HEDERA_OPERATOR_ID!;
const operatorKey = parseKey(process.env.HEDERA_OPERATOR_KEY!, process.env.HEDERA_OPERATOR_KEY_TYPE ?? "ECDSA");
const router      = new ethers.Wallet(process.env.ROUTER_PRIVATE_KEY!);
const client      = Client.forTestnet().setOperator(operatorId, operatorKey);

let TOPIC_ID = process.env.HCS_TOPIC_ID || "";   // ONE persistent topic for the whole demo

async function ensureTopic(): Promise<string> {
  if (TOPIC_ID) return TOPIC_ID;
  const resp = await new TopicCreateTransaction()
    .setTopicMemo("BoA usage-receipt proof rail")
    .setAdminKey(operatorKey.publicKey)
    .setSubmitKey(operatorKey.publicKey)   // only BoA's key may append receipts
    .execute(client);
  TOPIC_ID = (await resp.getReceipt(client)).topicId!.toString();
  console.log(`[boot] created topic ${TOPIC_ID} — set HCS_TOPIC_ID=${TOPIC_ID} in Railway to keep it stable across restarts`);
  return TOPIC_ID;
}

async function fetchMessageBySeq(topicId: string, seq: number, tries = 30, delayMs = 1500) {
  const url = `${MIRROR}/api/v1/topics/${topicId}/messages/${seq}`;
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url);
    if (r.ok) return r.json();
    await new Promise((s) => setTimeout(s, delayMs));
  }
  throw new Error(`mirror node timeout for ${url}`);
}

// preset receipt, with optional per-request overrides (for the "editable fields" flourish)
function buildReceipt(src: any): UnsignedReceipt {
  const base = sampleUnsignedReceipt();
  const num = (v: any, d: number) => (v === undefined || v === "" ? d : Number(v));
  return {
    ...base,
    agent_ens:       src?.agent_ens       ?? base.agent_ens,
    model:           src?.model           ?? base.model,
    input_tokens:    num(src?.input_tokens,  base.input_tokens),
    output_tokens:   num(src?.output_tokens, base.output_tokens),
    total_cost_usdc: src?.total_cost_usdc ?? base.total_cost_usdc,
    settlement_tx:   src?.settlement_tx   ?? base.settlement_tx,
  };
}

const hashscan = (t: string, seq?: number) =>
  seq ? `https://hashscan.io/testnet/topic/${t}` : `https://hashscan.io/testnet/topic/${t}`;

const app = express();
app.use(cors({ origin: ORIGIN }));
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  res.json({ ok: true, network: "testnet", topicId: TOPIC_ID || null,
             operator: operatorId, routerAddress: await router.getAddress() });
});

// One-shot emit (simplest for the frontend; returns everything at once)
app.post("/api/receipts/emit", async (req, res) => {
  try {
    const topicId = await ensureTopic();
    const receipt: UsageReceipt = await signReceipt(buildReceipt(req.body), router);
    const submit = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(JSON.stringify(receipt))
      .execute(client);
    const seq = (await submit.getReceipt(client)).topicSequenceNumber!.toNumber();
    const mn = await fetchMessageBySeq(topicId, seq);
    const readBack = JSON.parse(Buffer.from(mn.message, "base64").toString("utf8"));
    const recovered = verifyReceipt(readBack);
    const routerAddress = await router.getAddress();
    res.json({
      ok: true, topicId, sequenceNumber: seq, consensusTimestamp: mn.consensus_timestamp,
      receipt, routerAddress, recoveredSigner: recovered,
      signatureValid: recovered.toLowerCase() === routerAddress.toLowerCase(),
      bytesMatch: canonicalJSON(receipt as any) === canonicalJSON(readBack as any),
      digest: receiptDigest(receipt),
      hashscanUrl: hashscan(topicId, seq),
      mirrorUrl: `${MIRROR}/api/v1/topics/${topicId}/messages/${seq}`,
    });
  } catch (e: any) { res.status(500).json({ ok: false, error: String(e?.message ?? e) }); }
});

// Streaming emit (Server-Sent Events) — drives the step-by-step animation.
// EventSource is GET-only, so overrides come in via query params.
app.get("/api/receipts/emit/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (event: string, data: any) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  try {
    const topicId = await ensureTopic();
    const routerAddress = await router.getAddress();

    const unsigned = buildReceipt(req.query);
    send("meter", { receipt: unsigned });

    const receipt = await signReceipt(unsigned, router);
    send("sign", { router_signature: receipt.router_signature, routerAddress, recovered: verifyReceipt(receipt) });

    send("submit_start", { topicId });
    const submit = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId)).setMessage(JSON.stringify(receipt)).execute(client);
    const seq = (await submit.getReceipt(client)).topicSequenceNumber!.toNumber();
    send("submit", { sequenceNumber: seq, topicId });

    send("verify_start", { sequenceNumber: seq });
    const mn = await fetchMessageBySeq(topicId, seq);
    const readBack = JSON.parse(Buffer.from(mn.message, "base64").toString("utf8"));
    const recovered = verifyReceipt(readBack);

    send("done", {
      topicId, sequenceNumber: seq, consensusTimestamp: mn.consensus_timestamp, receipt: readBack,
      routerAddress, recoveredSigner: recovered,
      signatureValid: recovered.toLowerCase() === routerAddress.toLowerCase(),
      bytesMatch: canonicalJSON(receipt as any) === canonicalJSON(readBack as any),
      digest: receiptDigest(receipt),
      hashscanUrl: hashscan(topicId, seq),
      mirrorUrl: `${MIRROR}/api/v1/topics/${topicId}/messages/${seq}`,
    });
  } catch (e: any) { send("error", { error: String(e?.message ?? e) }); }
  finally { res.end(); }
});

// The growing audit log — read straight from the mirror node, newest first.
app.get("/api/receipts", async (_req, res) => {
  try {
    if (!TOPIC_ID) return res.json({ ok: true, topicId: null, receipts: [] });
    const r = await fetch(`${MIRROR}/api/v1/topics/${TOPIC_ID}/messages?limit=25&order=desc`);
    const j: any = await r.json();
    const receipts = (j.messages ?? []).map((m: any) => {
      let parsed: any = null;
      try { parsed = JSON.parse(Buffer.from(m.message, "base64").toString("utf8")); } catch {}
      return { sequenceNumber: m.sequence_number, consensusTimestamp: m.consensus_timestamp,
               receipt: parsed, hashscanUrl: hashscan(TOPIC_ID, m.sequence_number) };
    });
    res.json({ ok: true, topicId: TOPIC_ID, receipts });
  } catch (e: any) { res.status(500).json({ ok: false, error: String(e?.message ?? e) }); }
});

app.listen(PORT, () => console.log(`BoA Hedera API listening on :${PORT}`));
```

### A3. Start command + package.json

Add to `spikes/hedera/package.json` scripts:

```json
"start": "tsx src/server.ts"
```

(or `"start": "npx tsx src/server.ts"`). Railway will run `npm start`.

### A4. Railway setup

1. **New service → Deploy from this repo**, branch `claude/busy-feynman-lxbsjr`
   (or wherever you merge it). **Set the service Root Directory to `spikes/hedera`.**
2. **Build:** `npm install` &nbsp;•&nbsp; **Start:** `npm start` (Railway auto-detects, or set it).
3. **Variables** (Railway → Variables) — these mirror your `.env`, **server-side only**:

   | Variable | Value |
   |---|---|
   | `HEDERA_OPERATOR_ID` | `0.0.9186016` |
   | `HEDERA_OPERATOR_KEY` | the ECDSA hex key |
   | `HEDERA_OPERATOR_KEY_TYPE` | `ECDSA` |
   | `HEDERA_MIRROR_NODE_URL` | `https://testnet.mirrornode.hedera.com` |
   | `ROUTER_PRIVATE_KEY` | the stable router key (`0xe8B1…` address) |
   | `HCS_TOPIC_ID` | *(leave empty first deploy → it creates one and logs the id → then set it here so the topic is stable)* |
   | `ALLOWED_ORIGIN` | your frontend URL, e.g. `https://app.bankofagent.xyz` |

   Railway sets `PORT` automatically — don't hardcode it.
4. **First deploy:** check logs for `created topic 0.0.xxxx`, copy that id into `HCS_TOPIC_ID`,
   redeploy. Now every emit appends to that one topic.
5. Verify: `curl https://<your-service>.up.railway.app/api/health` → `{ ok:true, topicId, routerAddress, … }`.

> **Railway can do the gRPC write** — unlike the Claude cloud sandbox, Railway containers
> have full outbound egress, so the consensus-node submission (ports 50211/50212) works.
> Do one smoke-test (`curl -X POST …/api/receipts/emit`) after deploy.

---

## API contract (what your frontend codes against)

| Method & path | Purpose | Response (key fields) |
|---|---|---|
| `GET /api/health` | service + topic info | `{ ok, network, topicId, operator, routerAddress }` |
| `POST /api/receipts/emit` | emit one receipt (one-shot) | `{ ok, topicId, sequenceNumber, consensusTimestamp, receipt, routerAddress, recoveredSigner, signatureValid, bytesMatch, digest, hashscanUrl, mirrorUrl }` |
| `GET /api/receipts/emit/stream?…` | emit with **SSE** step events | events: `meter`, `sign`, `submit_start`, `submit`, `verify_start`, `done`, `error` |
| `GET /api/receipts` | the audit log (newest first) | `{ ok, topicId, receipts: [{ sequenceNumber, consensusTimestamp, receipt, hashscanUrl }] }` |

**SSE event payloads**

```
event: meter        data: { receipt: {…unsigned…} }
event: sign         data: { router_signature, routerAddress, recovered }
event: submit_start data: { topicId }
event: submit       data: { sequenceNumber, topicId }
event: verify_start data: { sequenceNumber }
event: done         data: { topicId, sequenceNumber, consensusTimestamp, receipt, signatureValid, bytesMatch, recoveredSigner, digest, hashscanUrl, mirrorUrl }
event: error        data: { error }
```

POST/stream optional override fields: `agent_ens, model, input_tokens, output_tokens, total_cost_usdc, settlement_tx`.

---

## Part B — frontend integration (paste this prompt to your frontend coding agent)

> **Prompt to use in your frontend repo:**
>
> Add a `HederaReceiptDemo` component to our app that demonstrates writing a router-signed
> usage receipt to Hedera Consensus Service via our API at `import.meta.env.VITE_BOA_HEDERA_API`
> (set this env var to the Railway service URL).
>
> Behavior:
> - A primary button **"Emit usage receipt"**. On click, open an `EventSource` to
>   `${API}/api/receipts/emit/stream` and drive a **5-step horizontal pipeline**:
>   **Meter → Sign → Create/Submit → Verify → On-chain**. Each step starts as a pulsing
>   dot and turns into a green check as its SSE event arrives (`meter`, `sign`, `submit`,
>   `done`). Show a spinner on the active step.
> - On `sign`: render the `router_signature` (truncated) and a badge **"signed by router
>   `<routerAddress>`"**; on `done` show **"signature verified ✓"** when `signatureValid`.
> - On `submit`: show the **sequence number** prominently (e.g. `#5`).
> - On `done`: show a green **"on-chain ✓"** badge, the `consensusTimestamp`, a
>   **MATCH** badge when `bytesMatch`, and two links: **View on HashScan** (`hashscanUrl`,
>   open new tab) and **Raw mirror-node JSON** (`mirrorUrl`).
> - Render the full signed `receipt` JSON in a collapsible code block.
> - Below the pipeline, render an **audit-log table** (the append-only proof trail):
>   poll `GET ${API}/api/receipts` on mount and after each successful emit; columns:
>   `#seq`, `agent_ens`, `model`, `total_cost_usdc`, `consensusTimestamp`, HashScan link.
>   Newest row highlights briefly when it's the one just emitted.
> - (Optional, since we want judge interactivity) a small form above the button with
>   editable `agent_ens`, `model`, `total_cost_usdc`; pass them as query params to the
>   stream URL.
> - Handle `error` events: close the EventSource, show the error text, re-enable the button.
> - Match our existing design system / Tailwind tokens; don't add a UI library.
> - **Never** put any Hedera private key in the frontend — all signing/submitting is the API's job.

### B1. Minimal SSE client (drop-in helper)

```ts
const API = import.meta.env.VITE_BOA_HEDERA_API; // e.g. https://boa-hedera.up.railway.app

export type EmitHandlers = {
  onMeter?: (d: any) => void;
  onSign?: (d: any) => void;
  onSubmit?: (d: any) => void;
  onVerifyStart?: (d: any) => void;
  onDone: (d: any) => void;
  onError: (msg: string) => void;
};

export function emitReceiptStream(
  overrides: Record<string, string> = {},
  h: EmitHandlers,
): () => void {
  const qs = new URLSearchParams(overrides).toString();
  const es = new EventSource(`${API}/api/receipts/emit/stream${qs ? `?${qs}` : ""}`);
  es.addEventListener("meter",        (e) => h.onMeter?.(JSON.parse((e as MessageEvent).data)));
  es.addEventListener("sign",         (e) => h.onSign?.(JSON.parse((e as MessageEvent).data)));
  es.addEventListener("submit",       (e) => h.onSubmit?.(JSON.parse((e as MessageEvent).data)));
  es.addEventListener("verify_start", (e) => h.onVerifyStart?.(JSON.parse((e as MessageEvent).data)));
  es.addEventListener("done",         (e) => { h.onDone(JSON.parse((e as MessageEvent).data)); es.close(); });
  es.addEventListener("error",        (e) => {
    const msg = (e as MessageEvent).data ? JSON.parse((e as MessageEvent).data).error : "stream error";
    h.onError(msg); es.close();
  });
  return () => es.close();
}

export async function fetchAuditLog() {
  const r = await fetch(`${API}/api/receipts`);
  return (await r.json()).receipts as Array<{
    sequenceNumber: number; consensusTimestamp: string; receipt: any; hashscanUrl: string;
  }>;
}
```

### B2. Reference React component (trim to your design system)

```tsx
import { useEffect, useState } from "react";
import { emitReceiptStream, fetchAuditLog } from "./hederaApi";

const STEPS = ["Meter", "Sign", "Submit", "Verify", "On-chain"] as const;

export function HederaReceiptDemo() {
  const [active, setActive] = useState(-1);   // index into STEPS
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [signInfo, setSignInfo] = useState<any>(null);
  const [seq, setSeq] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<any[]>([]);
  const [form, setForm] = useState({ agent_ens: "agent-a.boa.eth", model: "openai/gpt-4o", total_cost_usdc: "0.004212" });

  const refreshLog = () => fetchAuditLog().then(setLog).catch(() => {});
  useEffect(() => { refreshLog(); }, []);

  function emit() {
    setBusy(true); setErr(null); setResult(null); setSignInfo(null); setSeq(null); setActive(0);
    emitReceiptStream(form, {
      onMeter:  () => setActive(0),
      onSign:   (d) => { setSignInfo(d); setActive(1); },
      onSubmit: (d) => { setSeq(d.sequenceNumber); setActive(2); },
      onVerifyStart: () => setActive(3),
      onDone:   (d) => { setResult(d); setActive(4); setBusy(false); refreshLog(); },
      onError:  (m) => { setErr(m); setBusy(false); setActive(-1); },
    });
  }

  return (
    <div className="space-y-6">
      {/* editable fields (optional flourish) */}
      <div className="flex gap-3">
        <input value={form.agent_ens} onChange={e => setForm({ ...form, agent_ens: e.target.value })} placeholder="agent ENS" />
        <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="model" />
        <input value={form.total_cost_usdc} onChange={e => setForm({ ...form, total_cost_usdc: e.target.value })} placeholder="cost USDC" />
        <button disabled={busy} onClick={emit}>{busy ? "Emitting…" : "Emit usage receipt"}</button>
      </div>

      {/* 5-step pipeline */}
      <div className="flex items-center gap-4">
        {STEPS.map((label, i) => (
          <div key={label} className={`step ${i < active ? "done" : i === active ? "active" : ""}`}>
            <span className="dot">{i < active || (i === 4 && result) ? "✓" : i + 1}</span>
            <span>{label}</span>
          </div>
        ))}
      </div>

      {signInfo && <p>signed by router <code>{signInfo.routerAddress}</code></p>}
      {seq != null && <p>consensus sequence <strong>#{seq}</strong></p>}

      {result && (
        <div className="result">
          <span className="badge ok">on-chain ✓</span>
          {result.signatureValid && <span className="badge ok">signature verified ✓</span>}
          {result.bytesMatch && <span className="badge ok">read-back MATCH ✓</span>}
          <p>consensus timestamp: {result.consensusTimestamp}</p>
          <a href={result.hashscanUrl} target="_blank" rel="noreferrer">View on HashScan ↗</a>{" "}
          <a href={result.mirrorUrl} target="_blank" rel="noreferrer">Raw mirror-node JSON ↗</a>
          <details><summary>signed receipt</summary>
            <pre>{JSON.stringify(result.receipt, null, 2)}</pre>
          </details>
        </div>
      )}

      {err && <p className="error">⚠ {err}</p>}

      {/* append-only audit log */}
      <table>
        <thead><tr><th>#</th><th>agent</th><th>model</th><th>USDC</th><th>consensus ts</th><th></th></tr></thead>
        <tbody>
          {log.map(r => (
            <tr key={r.sequenceNumber}>
              <td>{r.sequenceNumber}</td>
              <td>{r.receipt?.agent_ens}</td>
              <td>{r.receipt?.model}</td>
              <td>{r.receipt?.total_cost_usdc}</td>
              <td>{r.consensusTimestamp}</td>
              <td><a href={r.hashscanUrl} target="_blank" rel="noreferrer">HashScan ↗</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

### B3. Frontend env var

```
VITE_BOA_HEDERA_API=https://<your-railway-service>.up.railway.app
```

(Use `NEXT_PUBLIC_BOA_HEDERA_API` instead if you're on Next.js, and read it from
`process.env`.)

---

## Demo choreography (what the judge sees)

1. Click **Emit usage receipt** → the pipeline lights up left-to-right: Meter ✓, Sign ✓
   (router address appears), Submit ✓ (sequence `#N` appears), Verify ✓, **On-chain ✓**.
2. The new row appears at the top of the **audit log** table.
3. Click **View on HashScan** → the message is there on the public explorer, with a
   consensus timestamp.
4. Click again → sequence number increments; the log grows. *"Every agent call is an
   immutable, ordered, signed receipt on Hedera — a verifiable audit trail."*

---

## Gotchas

- **CORS:** set `ALLOWED_ORIGIN` to your exact frontend origin in prod (use `*` only while testing).
- **Keep the topic stable:** set `HCS_TOPIC_ID` after the first deploy, else a restart makes a new topic and the log "resets".
- **Funding:** the operator account needs testnet HBAR (each emit costs a fraction of 1 HBAR). Testnet resets periodically → re-fund at <https://portal.hedera.com/faucet>.
- **Mirror lag:** the API already polls the mirror node (~2–6s) before returning `done`; that's why "Verify" takes a moment — it's real consensus + propagation, not a fake delay.
- **Concurrency:** sequence numbers are assigned by consensus, so rapid double-clicks just produce `#N`, `#N+1` — fine.
- **Never** expose `HEDERA_OPERATOR_KEY` / `ROUTER_PRIVATE_KEY` to the browser. The frontend only calls the API.
```
