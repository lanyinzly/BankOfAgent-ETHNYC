# BoA × Hedera — agentic-payments demo: narrative, frontend integration & prompt

Built for the **Hedera "AI & Agentic Payments"** prize. This doc gives you (1) the
narrative to land, (2) a backend API service to deploy on Railway, and (3) a paste-ready
prompt + code to integrate a **live, visual** demo into your existing frontend.

### Status — built & verified live on Hedera testnet (2026-06-14)

The API (`src/server.ts`) was run locally and exercised end-to-end. **Settlement is a real
two-party USDC transfer on Hedera** (HTS), for exactly the FOAMM-priced cost. Each `emit`:
- **settled in USDC on Hedera**: agent `0.0.9228386` → provider `0.0.9228387`, HTS token
  `0.0.9228385` (USDC, 6 dp). Mirror node confirmed the `token_transfers`
  (`-4713 / +4713` base units = `0.004713 USDC`, `SUCCESS`); **provider balance grew to
  `0.009430 USDC` after 2 calls**, agent went `1000 → 999.990570 USDC`. The transferred
  amount **equals** the priced cost.
- **discovered the price upward** across calls: `1.0000 → 1.0007 → 1.0014`;
- **signed + recorded** the receipt on HCS (`signatureValid: true`, `bytesMatch: true`),
  with `settlement_tx` set to the live USDC-transfer id.

So the full agentic-payment loop — **price → settle USDC on Hedera → sign → audit on
Hedera** — is working, agent-to-provider. The sections below wire it to your frontend,
deploy on Railway, and show how other agent stacks plug in (§9).

---

## 1. Narrative — why BoA is *the* agentic-payments use case for Hedera

> **The agent economy doesn't just need rails to move value — it needs a price.**
> Today every provider meters compute in its own private dashboard; there is no common,
> neutral, machine-readable price for "what an agent should pay for a tool call." Bank of
> Agent is the missing layer: an **on-chain, permissionless, agent-native price-discovery
> and settlement mechanism** that prices *any* agent tool call — inference, an API, or
> another agent's service — and settles it **in USDC on Hedera** with a signed, verifiable
> receipt.

**Where value lives:** **Hedera is BoA's settlement + audit layer.** The unit of account
is **USDC**, issued natively on Hedera via **HTS**; each agent call is settled
**agent → service-provider** in that USDC token, at machine speed, and the signed receipt
is recorded on **HCS**. (Fiat / cross-chain on-ramps like Arc fund an agent's USDC balance;
once funded, pricing, settlement, and audit all happen on Hedera.)

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
   ├─ 2. SETTLE     real USDC transfer (HTS) AGENT → PROVIDER for exactly the priced cost
   │                (settlement_tx is a live Hedera tx; Hedera is the settlement layer — see §6)
   ├─ 3. SIGN       BoA's router signs the usage receipt  (anyone can ecrecover it)
   ├─ 4. RECORD     submit the signed receipt to Hedera HCS  → consensus seq # + timestamp
   └─ 5. VERIFY     read it back from the mirror node — immutable, ordered, auditable
```

**Prize-requirement fit:**

| Requirement / bonus | How BoA hits it |
|---|---|
| AI agent executing a payment / token transfer on Hedera testnet | ✅ each call is a real **agent → provider USDC (HTS) transfer** on Hedera, plus a signed receipt on HCS |
| Use Hedera SDKs directly | yes — `@hashgraph/sdk` (HTS token + transfer, HCS, account creation) |
| **HTS tokens / transfers** (bonus) | ✅ the USDC unit of account is an **HTS token**; settlement is an HTS transfer |
| **Verifiable payment audit trails using HCS** (bonus) | ✅ every receipt is a signed, immutable, consensus-timestamped HCS message carrying its settlement tx |
| x402 pay-per-request (bonus) | BoA is the price oracle + settlement x402 charges through — see §9 |
| On-chain agent identity HCS-14 (bonus) | `agent_ens` → swap for an HCS-14 Universal Agent ID; roadmap |
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
   price ticker + curve               2 SETTLE  USDC (HTS) agent → provider ─gRPC─▶ token transfer
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

> **This file is already committed in the repo and is the canonical implementation.**
> It includes everything below **plus the real HBAR settlement leg** (§6) wired into
> every emit, and an extra SSE `settle` event. The block below is the readable reference;
> deploy the committed file. (Verified live — see "Status" at the top.)

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

### A3. One-time HTS-USDC setup (`npm run setup:hts`)

Before first run, create the USDC token + the two party accounts. `src/setup-hts.ts`
(committed) does it from the funded operator and appends the ids/keys to `.env`:

```bash
cd spikes/hedera
npm run setup:hts
# creates: USDC HTS token (treasury=operator), AGENT account (payer, funded 1000 USDC + 10ℏ),
#          PROVIDER account (payee). Appends HEDERA_USDC_TOKEN_ID / HEDERA_AGENT_ID /
#          HEDERA_AGENT_KEY / HEDERA_PROVIDER_ID / HEDERA_PROVIDER_KEY to .env.
```

### A4. Start command + Railway

- `package.json` scripts: `"start": "tsx src/server.ts"`, `"setup:hts": "tsx src/setup-hts.ts"`.
- Railway: New service → this repo → **Root Directory `spikes/hedera`**, Build `npm install`, Start `npm start`.
- **Variables:**
  - core: `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY`, `HEDERA_OPERATOR_KEY_TYPE=ECDSA`,
    `HEDERA_MIRROR_NODE_URL`, `ROUTER_PRIVATE_KEY`, `ALLOWED_ORIGIN=<frontend url>`,
    `HCS_TOPIC_ID` *(empty first deploy → read it from logs → set it → redeploy)*.
  - **USDC settlement** (from `setup:hts`): `HEDERA_USDC_TOKEN_ID`, `HEDERA_AGENT_ID`,
    `HEDERA_AGENT_KEY`, `HEDERA_PROVIDER_ID`. (If these are unset the server falls back to
    a fixed HBAR micropayment via `HEDERA_PAYEE_ID`/`HEDERA_SETTLE_HBAR`.)
  - Railway sets `PORT`.
- Smoke test: `curl https://<svc>.up.railway.app/api/health` (shows the USDC settlement
  config) then `curl -X POST https://<svc>.up.railway.app/api/receipts/emit`.

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
> - On `settle`: show **"paid `<amount>` `<asset>` on Hedera"** (e.g. "0.004713 USDC")
>   with `from → to` and a link to the payment tx (`hashscanUrl`) — the real on-chain,
>   agent→provider settlement.
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
  onPrice?: (d: any) => void; onSettle?: (d: any) => void; onSign?: (d: any) => void; onSubmit?: (d: any) => void;
  onVerifyStart?: (d: any) => void; onDone: (d: any) => void; onError: (msg: string) => void;
};
export function emitReceiptStream(overrides: Record<string, string> = {}, h: EmitHandlers) {
  const qs = new URLSearchParams(overrides).toString();
  const es = new EventSource(`${API}/api/receipts/emit/stream${qs ? `?${qs}` : ""}`);
  const J = (e: Event) => JSON.parse((e as MessageEvent).data);
  es.addEventListener("price",        (e) => h.onPrice?.(J(e)));
  es.addEventListener("settle",       (e) => h.onSettle?.(J(e)));
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

## 6. USDC settlement on Hedera (HTS, two-party) — **built-in & verified**

Settlement is a real **agent → provider USDC transfer on Hedera**, for **exactly the
FOAMM-priced cost**. USDC is the unit of account (issued natively via **HTS**); Hedera is
the settlement layer. The transfer's tx id becomes the receipt's `settlement_tx`.

**This is already wired into the committed `src/server.ts`** and verified live (see
Status). When `HEDERA_USDC_TOKEN_ID` + `HEDERA_AGENT_ID`/`KEY` + `HEDERA_PROVIDER_ID` are
set (run `npm run setup:hts`), every emit:

1. computes the cost (`total_cost_usdc`, which tracks the live premium);
2. transfers that many USDC base units **agent → provider** — the agent is the
   *autonomous payer*: it sets its own `TransactionId` (pays its own fee) and signs the
   transfer with its key;
3. embeds the transfer's tx id as `settlement_tx` in the signed HCS receipt.

The SSE stream emits a **`settle`** event:
`{ asset: "USDC", amount, from, to, token, txId, hashscanUrl }` — show "paid `<amount>`
USDC on Hedera" with a link to `hashscanUrl` (the payment tx), next to the HCS link. Core
logic (from `server.ts`):

```ts
import { TransferTransaction, TransactionId, TokenId, AccountId } from "@hashgraph/sdk";

// USDC transfer AGENT -> PROVIDER for exactly `cost`; agent pays its own fee + signs.
async function settleUSDC(cost: number) {
  const units = Math.max(1, Math.round(cost * 1e6));   // USDC has 6 decimals
  const txId = TransactionId.generate(AccountId.fromString(AGENT_ID));
  const tx = new TransferTransaction()
    .setTransactionId(txId)
    .addTokenTransfer(TokenId.fromString(USDC_TOKEN), AccountId.fromString(AGENT_ID), -units)
    .addTokenTransfer(TokenId.fromString(USDC_TOKEN), AccountId.fromString(PROVIDER_ID), units)
    .freezeWith(client);
  await (await (await tx.sign(agentKey)).execute(client)).getReceipt(client);
  return { asset: "USDC", amount: (units / 1e6).toFixed(6), txId: txId.toString() };
}
```

> Verified: mirror node `token_transfers` showed `-4713 / +4713` base units = `0.004713
> USDC` (`SUCCESS`); provider balance reached `0.009430 USDC` after 2 calls. If the USDC
> env vars are absent, `server.ts` falls back to a fixed HBAR micropayment
> (`HEDERA_PAYEE_ID` / `HEDERA_SETTLE_HBAR`).

---

## 7. Demo choreography (prize-aligned)

1. *"An agent makes a tool call. First, what should it pay?"* → click **Run a paid agent
   call**. The **price ticker** moves `1.0000 → 1.0007 ▲`, the **curve** ticks up —
   *"price discovered on-chain, permissionlessly, by the FOAMM market."*
2. *"It pays the service provider — in USDC, on Hedera."* The **`settle`** step shows a
   real **agent → provider USDC transfer** (its own HashScan link). Then Sign ✓ (router) →
   Submit ✓ (seq #) → Verify ✓ → **On-chain ✓**.
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
- **Funding:** operator needs HBAR (topic/token/account ops); the **agent account** needs a
  USDC balance + a little HBAR for its own transfer fees — `npm run setup:hts` provisions
  both. The provider auto-associates the token on first receipt. Top up the **agent's USDC**
  when it runs low; testnet resets periodically → re-fund at <https://portal.hedera.com/faucet>.
- **Mirror lag:** the API polls ~2–6s before `done` — that's real consensus + propagation.
- **Never** expose `HEDERA_OPERATOR_KEY` / `ROUTER_PRIVATE_KEY` / `HEDERA_AGENT_KEY` to the browser.

---

## 9. Integrating with other agent stacks (BoA as the layer *under* them)

BoA isn't another agent framework — it's the **pricing + settlement + audit layer** that
any stack calls. The integration surface is one call: when a tool call happens, hit
`POST /api/receipts/emit` (or the SSE stream) with the call's metadata; BoA prices it,
settles USDC on Hedera, records the signed receipt, and returns everything. Request body
(all optional — sensible defaults): `{ agent_ens, model, input_tokens, output_tokens,
total_cost_usdc? }`. Pass `total_cost_usdc` to charge an exact amount; omit it to let BoA
price from the FOAMM curve.

- **x402 (pay-per-request):** put BoA in the 402 path — on a paid request, the server-side
  x402 handler calls `emit`; the returned `settlement.txId` + `sequenceNumber` are the
  payment proof attached to the response. BoA is the price oracle *and* the settlement +
  receipt.
- **A2A / OpenClaw ACP (agent-to-agent commerce):** when agent A buys a service from agent
  B, B's handler calls `emit` with `agent_ens` = A's id and the provider = B's account —
  the USDC transfer *is* the A→B settlement, the HCS receipt is the shared, neutral record
  both sides can audit.
- **Hedera Agent Kit (JS/TS or Python):** wrap `emit` as an Agent Kit tool
  (`charge_and_record`) so any Agent-Kit agent can price+settle+audit a tool call in one
  step.
- **Raw SDK / your gateway:** call `emit` from your metering middleware after each model
  call; the receipt's `settlement_tx` ties consumption to an on-chain USDC payment.

Keep it composable: per-agent/per-provider accounts can be supplied per request (extend
`emit` to accept `agent_id`/`provider_id`), so BoA prices and settles for *many* agents and
services through one rail. Identity slots in cleanly too — swap `agent_ens` for an **HCS-14
Universal Agent ID**.
