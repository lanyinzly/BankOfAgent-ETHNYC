# BoA × Hedera — agentic-payments demo: narrative, frontend integration & prompt

Built for the **Hedera "AI & Agentic Payments"** prize. This doc gives you (1) the
narrative to land, (2) a backend API service to deploy on Railway, and (3) a paste-ready
prompt + code to integrate a **live, visual** demo into your existing frontend.

---

## 1. Narrative — why BoA is *the* agentic-payments use case for Hedera

> **The agent economy doesn't just need rails to move value — it needs a price.**
> Today every provider meters compute in its own private dashboard; there is no common,
> neutral, machine-readable price for "what an agent should pay for a tool call." Bank of
> Agent is the missing layer: an **on-chain, permissionless, agent-native price-discovery
> and settlement mechanism** that prices *any* agent tool call — inference, an API, or
> another agent's service — and settles it on Hedera with a signed, verifiable receipt.

Three things to emphasize to judges:

1. **The innovation is the pricing mechanism, not another agent framework.** BoA's
   ERC-7527 / FOAMM voucher market discovers a *live premium* for agent compute —
   permissionlessly, on-chain. As agents consume capacity, the premium moves along a
   deterministic curve. That premium **is** the spot price; across maturities it **is** a
   forward curve. No provider sets it; the market does.
2. **It's stack-agnostic — it sits *under* every agent toolchain.** The same pricing +
   settlement rail applies whether the call comes through the Hedera Agent Kit, x402
   pay-per-request, A2A, OpenClaw ACP, or a raw SDK call. BoA prices the request; the
   tool stack does the work.
3. **Hedera is what makes per-call pricing actually viable.** Pricing that updates on
   *every* agent call only works when settlement is **sub-second final**, fees are
   **predictable and sub-cent**, and there's a **native, immutable audit trail**. That is
   exactly Hedera: HCS for the signed receipt / audit trail, fixed USD-denominated fees,
   3s finality. Machine-speed pricing needs machine-speed, predictable-cost settlement.

**How each agent call maps to a payment on Hedera (the flow the demo shows):**

```
agent calls a tool
   │
   ├─ 1. PRICE      FOAMM premium discovered on-chain:  price_before → price_after
   │                (the market moving as demand accrues — visible, permissionless)
   ├─ 2. SETTLE     pay for the call  (USDC cost; optionally a real HBAR micropayment
   │                on Hedera — see §6 — so settlement_tx is a live Hedera tx)
   ├─ 3. SIGN       BoA's router signs the usage receipt  (anyone can ecrecover it)
   ├─ 4. RECORD     submit the signed receipt to Hedera HCS  → consensus seq # + timestamp
   └─ 5. VERIFY     read it back from the mirror node — immutable, ordered, auditable
```

**Prize-requirement fit:**

| Requirement / bonus | How BoA hits it |
|---|---|
| AI agent executing a payment / financial operation on Hedera testnet | each call settles + writes a signed payment receipt as a paid HCS transaction (and, with §6, a real HBAR transfer) |
| Use Hedera SDKs directly | yes — `@hashgraph/sdk` (HCS + optional HTS/HBAR transfer) |
| **Verifiable payment audit trails using HCS** (bonus) | the core: every receipt is a signed, immutable, consensus-timestamped HCS message |
| x402 pay-per-request (bonus) | BoA is the price oracle x402 charges against — natural fit |
| On-chain agent identity HCS-14 (bonus) | `agent_ens` → swap for an HCS-14 Universal Agent ID; roadmap |
| HTS tokens / fees (bonus) | `membership_token_id` → an HTS membership/quota token; roadmap |
| Scheduled / recurring payments (bonus) | recurring agent subscriptions via Hedera Scheduled Transactions; roadmap |

---

## 2. What the frontend must *communicate* (the story it renders)

The UI isn't "emit a log line." It's a live **agent-payment + price-discovery + on-chain
audit** demo. It should show, every click:

- **a price moving** (`price_before → price_after`, with the Δ and an up-arrow) — this is
  the headline, "on-chain price discovery";
- a small **curve / sparkline** of `price_after` across the audit log — "the forward
  curve the market emits";
- the **cost** paid (`total_cost_usdc`) and the **settlement** reference;
- the **router signature** + recovered address ("signed, anyone can verify");
- the receipt landing **on Hedera** (sequence #, consensus timestamp, HashScan link);
- a **growing append-only audit log** — the verifiable payment trail.

---

## 3. Architecture (two pieces)

```
Your frontend (existing app)            BoA Hedera API (new Railway service)        Hedera testnet
────────────────────────────            ────────────────────────────────────       ──────────────
 <AgentPaymentsDemo/>          ──▶  GET /api/receipts/emit/stream (SSE)
   "Run a paid agent call"            1 PRICE   FOAMM premium (on-chain curve)
   price ticker + curve               2 SETTLE  cost in USDC (+ optional HBAR tx)
   5-step pipeline           ◀── SSE ─ 3 SIGN    router signs (keys live HERE only)
   audit-log table                    4 RECORD  submit to ONE persistent HCS topic ─gRPC─▶ seq#
                                       5 VERIFY  read back from mirror node ──HTTPS──▶ confirm
```

> **Hard rule:** operator key + router key live **only** on the API (Railway env vars),
> never in the browser. The frontend only calls the API.
> **Railway note:** Railway containers have full outbound egress, so the consensus-node
> gRPC write works there (it did *not* in the Claude cloud sandbox, which is 443-only).

---

## 4. Part A — the BoA Hedera API service (deploy on Railway)

Reuses `spikes/hedera/src/receipt.ts` (already in this repo). Deploy **this
`spikes/hedera` folder** as a Railway service (service Root Directory = `spikes/hedera`).

### A1. Dependencies

```bash
cd spikes/hedera
npm i express cors
npm i -D @types/express @types/cors
```

### A2. Server — `spikes/hedera/src/server.ts`

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
const PORT   = Number(process.env.PORT ?? 8080);
const ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";   // set to your frontend URL in prod

function parseKey(raw: string, type: string): PrivateKey {
  try { return type.toUpperCase() === "ECDSA" ? PrivateKey.fromStringECDSA(raw) : PrivateKey.fromStringED25519(raw); }
  catch { return PrivateKey.fromStringDer(raw); }
}
const num = (v: any, d: number) => (v === undefined || v === "" ? d : Number(v));

const operatorId  = process.env.HEDERA_OPERATOR_ID!;
const operatorKey = parseKey(process.env.HEDERA_OPERATOR_KEY!, process.env.HEDERA_OPERATOR_KEY_TYPE ?? "ECDSA");
const router      = new ethers.Wallet(process.env.ROUTER_PRIVATE_KEY!);
const client      = Client.forTestnet().setOperator(operatorId, operatorKey);

let TOPIC_ID = process.env.HCS_TOPIC_ID || "";       // ONE persistent topic for the demo

// ── on-chain-style price discovery: FOAMM premium rises along a curve as demand accrues ──
const BASE = 1.0, SLOPE = 0.0007;
const premiumAt = (k: number) => +(BASE * Math.pow(1 + SLOPE, k)).toFixed(4);
let curveIndex = 0, seeded = false;                  // advances once per emit

async function ensureTopic(): Promise<string> {
  if (!TOPIC_ID) {
    const resp = await new TopicCreateTransaction()
      .setTopicMemo("BoA agent-payment receipts (FOAMM-priced)")
      .setAdminKey(operatorKey.publicKey)
      .setSubmitKey(operatorKey.publicKey)           // only BoA's key may append receipts
      .execute(client);
    TOPIC_ID = (await resp.getReceipt(client)).topicId!.toString();
    console.log(`[boot] created topic ${TOPIC_ID} — set HCS_TOPIC_ID=${TOPIC_ID} in Railway to keep it stable`);
  }
  if (!seeded) {                                       // continue the curve from on-chain history
    try {
      const r = await fetch(`${MIRROR}/api/v1/topics/${TOPIC_ID}/messages?limit=1&order=desc`);
      curveIndex = (await r.json())?.messages?.[0]?.sequence_number ?? 0;
    } catch {}
    seeded = true;
  }
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

// build a receipt whose price + cost reflect the live FOAMM premium
function buildReceipt(src: any, priceBefore: number, priceAfter: number): UnsignedReceipt {
  const base = sampleUnsignedReceipt();
  const inTok = num(src?.input_tokens, base.input_tokens);
  const outTok = num(src?.output_tokens, base.output_tokens);
  const cost = +(0.000002 * (inTok + outTok) * priceAfter).toFixed(6); // cost tracks the premium
  return {
    ...base,
    agent_ens:       src?.agent_ens ?? base.agent_ens,
    model:           src?.model ?? base.model,
    input_tokens:    inTok,
    output_tokens:   outTok,
    total_cost_usdc: src?.total_cost_usdc ?? String(cost),
    settlement_tx:   src?.settlement_tx ?? base.settlement_tx,
    price_before:    priceBefore.toFixed(4),
    price_after:     priceAfter.toFixed(4),
  };
}

const topicUrl = (t: string) => `https://hashscan.io/testnet/topic/${t}`;

const app = express();
app.use(cors({ origin: ORIGIN }));
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  res.json({ ok: true, network: "testnet", topicId: TOPIC_ID || null,
             operator: operatorId, routerAddress: await router.getAddress(),
             nextPremium: premiumAt(curveIndex + 1) });
});

// One-shot emit
app.post("/api/receipts/emit", async (req, res) => {
  try {
    const topicId = await ensureTopic();
    const before = premiumAt(curveIndex), after = premiumAt(curveIndex + 1);
    const receipt: UsageReceipt = await signReceipt(buildReceipt(req.body, before, after), router);
    const submit = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId)).setMessage(JSON.stringify(receipt)).execute(client);
    const seq = (await submit.getReceipt(client)).topicSequenceNumber!.toNumber();
    curveIndex += 1;
    const mn = await fetchMessageBySeq(topicId, seq);
    const readBack = JSON.parse(Buffer.from(mn.message, "base64").toString("utf8"));
    const recovered = verifyReceipt(readBack);
    const routerAddress = await router.getAddress();
    res.json({
      ok: true, topicId, sequenceNumber: seq, consensusTimestamp: mn.consensus_timestamp,
      receipt, routerAddress, recoveredSigner: recovered,
      signatureValid: recovered.toLowerCase() === routerAddress.toLowerCase(),
      bytesMatch: canonicalJSON(receipt as any) === canonicalJSON(readBack as any),
      priceBefore: receipt.price_before, priceAfter: receipt.price_after,
      digest: receiptDigest(receipt),
      hashscanUrl: topicUrl(topicId), mirrorUrl: `${MIRROR}/api/v1/topics/${topicId}/messages/${seq}`,
    });
  } catch (e: any) { res.status(500).json({ ok: false, error: String(e?.message ?? e) }); }
});

// Streaming emit (SSE) — drives the step-by-step animation. EventSource is GET-only.
app.get("/api/receipts/emit/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (event: string, data: any) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  try {
    const topicId = await ensureTopic();
    const routerAddress = await router.getAddress();
    const before = premiumAt(curveIndex), after = premiumAt(curveIndex + 1);

    const unsigned = buildReceipt(req.query, before, after);
    send("price", { priceBefore: before.toFixed(4), priceAfter: after.toFixed(4),
                    delta: +(after - before).toFixed(4), receipt: unsigned });

    const receipt = await signReceipt(unsigned, router);
    send("sign", { router_signature: receipt.router_signature, routerAddress, recovered: verifyReceipt(receipt) });

    send("submit_start", { topicId });
    const submit = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId)).setMessage(JSON.stringify(receipt)).execute(client);
    const seq = (await submit.getReceipt(client)).topicSequenceNumber!.toNumber();
    curveIndex += 1;
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
      priceBefore: receipt.price_before, priceAfter: receipt.price_after,
      digest: receiptDigest(receipt),
      hashscanUrl: topicUrl(topicId), mirrorUrl: `${MIRROR}/api/v1/topics/${topicId}/messages/${seq}`,
    });
  } catch (e: any) { send("error", { error: String(e?.message ?? e) }); }
  finally { res.end(); }
});

// The growing audit log + the emitted price curve.
app.get("/api/receipts", async (_req, res) => {
  try {
    if (!TOPIC_ID) return res.json({ ok: true, topicId: null, receipts: [] });
    const r = await fetch(`${MIRROR}/api/v1/topics/${TOPIC_ID}/messages?limit=50&order=desc`);
    const j: any = await r.json();
    const receipts = (j.messages ?? []).map((m: any) => {
      let parsed: any = null;
      try { parsed = JSON.parse(Buffer.from(m.message, "base64").toString("utf8")); } catch {}
      return { sequenceNumber: m.sequence_number, consensusTimestamp: m.consensus_timestamp,
               receipt: parsed, hashscanUrl: topicUrl(TOPIC_ID) };
    });
    res.json({ ok: true, topicId: TOPIC_ID, receipts });
  } catch (e: any) { res.status(500).json({ ok: false, error: String(e?.message ?? e) }); }
});

app.listen(PORT, () => console.log(`BoA Hedera API on :${PORT}`));
```

### A3. Start command + Railway

- `package.json` script: `"start": "tsx src/server.ts"`
- Railway: New service → this repo → **Root Directory `spikes/hedera`**, Build `npm install`, Start `npm start`.
- **Variables:** `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY`, `HEDERA_OPERATOR_KEY_TYPE=ECDSA`,
  `HEDERA_MIRROR_NODE_URL`, `ROUTER_PRIVATE_KEY`, `ALLOWED_ORIGIN=<frontend url>`,
  `HCS_TOPIC_ID` *(empty first deploy → read it from logs → set it → redeploy)*.
  Railway sets `PORT`.
- Smoke test: `curl https://<svc>.up.railway.app/api/health` then `curl -X POST https://<svc>.up.railway.app/api/receipts/emit`.

---

## 5. Part B — frontend integration (paste this prompt to your frontend agent)

> **Prompt for your frontend repo:**
>
> Add an `AgentPaymentsDemo` component that demonstrates BoA pricing + settling a paid
> agent tool call and anchoring it on Hedera, via our API at
> `import.meta.env.VITE_BOA_HEDERA_API`.
>
> **Frame it as price discovery + payment + on-chain audit** (not "logging"). Header:
> *"On-chain, permissionless price discovery for the agent economy — priced by FOAMM,
> settled & audited on Hedera."*
>
> Behavior — button **"Run a paid agent call"**. On click open an `EventSource` to
> `${API}/api/receipts/emit/stream` (pass editable `agent_ens`, `model`, token counts as
> query params) and drive a **5-step pipeline: Price → Sign → Settle/Submit → Verify →
> On-chain**, each turning into a green check as its SSE event arrives
> (`price`, `sign`, `submit`, `done`):
> - On `price`: animate a **price ticker** `price_before → price_after` with the Δ and an
>   up-arrow — this is the headline. Also append `price_after` to a **sparkline** labeled
>   "forward curve (emitted by the market)".
> - On `sign`: show `router_signature` (truncated) + **"signed by router `<routerAddress>`"**.
> - On `submit`: show the **consensus sequence #** prominently.
> - On `done`: show **"on-chain ✓"**, **"signature verified ✓"** (when `signatureValid`),
>   **"read-back MATCH ✓"** (when `bytesMatch`), the `consensusTimestamp`, `total_cost_usdc`
>   paid, and links **View on HashScan** (`hashscanUrl`) + **Raw mirror JSON** (`mirrorUrl`).
> - Render the signed `receipt` JSON in a collapsible block.
> - Below: an **append-only audit-log table** (the verifiable payment trail) from
>   `GET ${API}/api/receipts`; columns `#seq, agent_ens, model, price_after, total_cost_usdc,
>   consensusTimestamp, HashScan`. Poll on mount + after each emit; highlight the new row.
> - Build the sparkline from the log's `price_after` series (oldest→newest) so judges see
>   the price *discovering upward* across calls.
> - Handle `error` events (close ES, show message, re-enable button).
> - Match our design system; **never** put any Hedera private key in the frontend.

### B1. SSE client helper

```ts
const API = import.meta.env.VITE_BOA_HEDERA_API; // e.g. https://boa-hedera.up.railway.app

export type EmitHandlers = {
  onPrice?: (d: any) => void; onSign?: (d: any) => void; onSubmit?: (d: any) => void;
  onVerifyStart?: (d: any) => void; onDone: (d: any) => void; onError: (msg: string) => void;
};
export function emitReceiptStream(overrides: Record<string, string> = {}, h: EmitHandlers) {
  const qs = new URLSearchParams(overrides).toString();
  const es = new EventSource(`${API}/api/receipts/emit/stream${qs ? `?${qs}` : ""}`);
  const J = (e: Event) => JSON.parse((e as MessageEvent).data);
  es.addEventListener("price",        (e) => h.onPrice?.(J(e)));
  es.addEventListener("sign",         (e) => h.onSign?.(J(e)));
  es.addEventListener("submit",       (e) => h.onSubmit?.(J(e)));
  es.addEventListener("verify_start", (e) => h.onVerifyStart?.(J(e)));
  es.addEventListener("done",         (e) => { h.onDone(J(e)); es.close(); });
  es.addEventListener("error",        (e) => { const d=(e as MessageEvent).data; h.onError(d?JSON.parse(d).error:"stream error"); es.close(); });
  return () => es.close();
}
export async function fetchAuditLog() {
  const r = await fetch(`${API}/api/receipts`);
  return (await r.json()).receipts as Array<{ sequenceNumber:number; consensusTimestamp:string; receipt:any; hashscanUrl:string }>;
}
```

### B2. Reference React component (trim to your design system)

```tsx
import { useEffect, useState } from "react";
import { emitReceiptStream, fetchAuditLog } from "./hederaApi";

const STEPS = ["Price", "Sign", "Submit", "Verify", "On-chain"] as const;

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values), W = 160, H = 36;
  const pts = values.map((v, i) =>
    `${(i / (values.length - 1)) * W},${H - ((v - lo) / (hi - lo || 1)) * H}`).join(" ");
  return <svg width={W} height={H}><polyline fill="none" stroke="currentColor" strokeWidth="2" points={pts} /></svg>;
}

export function AgentPaymentsDemo() {
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [price, setPrice] = useState<any>(null);   // { priceBefore, priceAfter, delta }
  const [signInfo, setSignInfo] = useState<any>(null);
  const [seq, setSeq] = useState<number | null>(null);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<any[]>([]);
  const [form, setForm] = useState({ agent_ens: "agent-a.boa.eth", model: "openai/gpt-4o" });

  const refresh = () => fetchAuditLog().then(setLog).catch(() => {});
  useEffect(() => { refresh(); }, []);

  function run() {
    setBusy(true); setErr(null); setResult(null); setSignInfo(null); setSeq(null); setPrice(null); setActive(0);
    emitReceiptStream(form, {
      onPrice: (d) => { setPrice(d); setActive(0); },
      onSign:  (d) => { setSignInfo(d); setActive(1); },
      onSubmit:(d) => { setSeq(d.sequenceNumber); setActive(2); },
      onVerifyStart: () => setActive(3),
      onDone:  (d) => { setResult(d); setActive(4); setBusy(false); refresh(); },
      onError: (m) => { setErr(m); setBusy(false); setActive(-1); },
    });
  }

  const curve = [...log].reverse().map(r => Number(r.receipt?.price_after)).filter(Number.isFinite);

  return (
    <div className="space-y-6">
      <header>
        <h2>On-chain price discovery for the agent economy</h2>
        <p>Priced by FOAMM · settled &amp; audited on Hedera</p>
      </header>

      <div className="flex gap-3">
        <input value={form.agent_ens} onChange={e => setForm({ ...form, agent_ens: e.target.value })} placeholder="agent ENS" />
        <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="model" />
        <button disabled={busy} onClick={run}>{busy ? "Running…" : "Run a paid agent call"}</button>
      </div>

      {/* headline: price discovery */}
      {price && (
        <div className="price-ticker">
          <span>{price.priceBefore}</span> → <strong>{price.priceAfter}</strong>
          <span className="up">▲ +{price.delta}</span>
          <span className="label">FOAMM premium (on-chain)</span>
        </div>
      )}
      {curve.length > 1 && (
        <div className="curve"><Sparkline values={curve} /> <span>forward curve emitted by the market</span></div>
      )}

      {/* 5-step pipeline */}
      <div className="flex items-center gap-4">
        {STEPS.map((label, i) => (
          <div key={label} className={`step ${i < active ? "done" : i === active ? "active" : ""}`}>
            <span className="dot">{i < active || (i === 4 && result) ? "✓" : i + 1}</span>{label}
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
          <p>paid {result.receipt?.total_cost_usdc} USDC · consensus {result.consensusTimestamp}</p>
          <a href={result.hashscanUrl} target="_blank" rel="noreferrer">View on HashScan ↗</a>{" "}
          <a href={result.mirrorUrl} target="_blank" rel="noreferrer">Raw mirror JSON ↗</a>
          <details><summary>signed receipt</summary><pre>{JSON.stringify(result.receipt, null, 2)}</pre></details>
        </div>
      )}
      {err && <p className="error">⚠ {err}</p>}

      {/* append-only payment audit trail */}
      <table>
        <thead><tr><th>#</th><th>agent</th><th>model</th><th>price</th><th>USDC</th><th>consensus ts</th><th></th></tr></thead>
        <tbody>
          {log.map(r => (
            <tr key={r.sequenceNumber}>
              <td>{r.sequenceNumber}</td><td>{r.receipt?.agent_ens}</td><td>{r.receipt?.model}</td>
              <td>{r.receipt?.price_after}</td><td>{r.receipt?.total_cost_usdc}</td><td>{r.consensusTimestamp}</td>
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
(Next.js: `NEXT_PUBLIC_BOA_HEDERA_API`, read from `process.env`.)

---

## 6. (Recommended for qualification strength) make the payment leg a *real* Hedera transfer

The prize centers on **payments on Hedera**. The HCS write already qualifies as a paid
financial operation, but you can make settlement an explicit on-chain value movement: a
sub-cent **HBAR micropayment per agent call** (or an HTS transfer of a USDC-equivalent),
so `settlement_tx` points to a real Hedera transaction. This is exactly the prize's
"micropayment streaming / machine-speed settlement."

Add to `server.ts`:

```ts
import { TransferTransaction, Hbar } from "@hashgraph/sdk";

// pay a tiny HBAR amount to a "service provider" account, return the real Hedera tx id
async function settleOnHedera(): Promise<string | undefined> {
  const payee = process.env.HEDERA_PAYEE_ID;          // a second testnet account id
  if (!payee) return undefined;
  const tx = await new TransferTransaction()
    .addHbarTransfer(operatorId, new Hbar(-0.001))
    .addHbarTransfer(payee, new Hbar(0.001))
    .execute(client);
  await tx.getReceipt(client);
  return tx.transactionId!.toString();                // → settlement_tx, real on Hedera
}
```

Then in the emit handlers, before signing: `const settlement_tx = await settleOnHedera();`
and pass it into `buildReceipt` (it already honors `src.settlement_tx`). Surface a second
HashScan link in the UI: `https://hashscan.io/testnet/transaction/<settlement_tx>`. Now
each click is **price-discovered → paid on Hedera → signed → audited on Hedera** — the
full agentic-payment loop, end to end on Hedera.

---

## 7. Demo choreography (prize-aligned)

1. *"An agent makes a tool call. First, what should it pay?"* → click **Run a paid agent
   call**. The **price ticker** moves `1.0000 → 1.0007 ▲`, the **curve** ticks up —
   *"price discovered on-chain, permissionlessly, by the FOAMM market."*
2. Pipeline lights up: Price ✓ → Sign ✓ (router address) → Submit ✓ (seq #) → Verify ✓ →
   **On-chain ✓**. *(With §6: also a real HBAR settlement tx.)*
3. New row tops the **audit log**; click **HashScan** → it's on the public ledger with a
   consensus timestamp.
4. Click a few more times: *"every call repriced, settled, and recorded — the price
   discovers upward as demand accrues. That's a forward curve for agent compute, and a
   verifiable payment audit trail, native on Hedera."*

---

## 8. Gotchas

- **CORS:** set `ALLOWED_ORIGIN` to your exact frontend origin in prod (`*` only for testing).
- **Keep the topic + curve stable:** set `HCS_TOPIC_ID` after first deploy; the curve seeds
  from on-chain message count, so a stable topic keeps the price continuous.
- **Funding:** operator account needs testnet HBAR (each emit, and each §6 transfer, costs a
  fraction of 1 HBAR). Testnet resets periodically → re-fund at <https://portal.hedera.com/faucet>.
- **Mirror lag:** the API polls ~2–6s before `done` — that's real consensus + propagation.
- **Never** expose `HEDERA_OPERATOR_KEY` / `ROUTER_PRIVATE_KEY` to the browser.
```
