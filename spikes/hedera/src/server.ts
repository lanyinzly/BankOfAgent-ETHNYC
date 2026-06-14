// BoA × Hedera — agentic-payments API.
//
// Each emit: PRICE (FOAMM premium) -> SETTLE (real USDC HTS transfer agent->provider,
// or HBAR fallback) -> SIGN (router) -> RECORD (HCS topic) -> VERIFY (mirror node).
// Operator/router/agent keys live ONLY here. Deploy on Railway (full gRPC egress).
//
// Reuses spikes/hedera/src/receipt.ts (the signed-receipt unit).
import "dotenv/config";
import express from "express";
import cors from "cors";
import {
  Client,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicId,
  TransferTransaction,
  TransactionId,
  TokenId,
  AccountId,
  Hbar,
} from "@hashgraph/sdk";
import { ethers } from "ethers";
import {
  sampleUnsignedReceipt,
  signReceipt,
  verifyReceipt,
  canonicalJSON,
  receiptDigest,
  type UnsignedReceipt,
  type UsageReceipt,
} from "./receipt";

const MIRROR = process.env.HEDERA_MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";
const PORT = Number(process.env.PORT ?? 8080);
const ORIGIN = process.env.ALLOWED_ORIGIN ?? "*"; // set to your frontend URL in prod

function parseKey(raw: string, type = "ED25519"): PrivateKey {
  try {
    return type.toUpperCase() === "ECDSA" ? PrivateKey.fromStringECDSA(raw) : PrivateKey.fromStringED25519(raw);
  } catch {
    return PrivateKey.fromStringDer(raw);
  }
}
const num = (v: any, d: number) => (v === undefined || v === "" ? d : Number(v));

const operatorId = process.env.HEDERA_OPERATOR_ID!;
const operatorKey = parseKey(process.env.HEDERA_OPERATOR_KEY!, process.env.HEDERA_OPERATOR_KEY_TYPE ?? "ED25519");
const router = new ethers.Wallet(process.env.ROUTER_PRIVATE_KEY ?? ethers.Wallet.createRandom().privateKey);
const client = Client.forTestnet().setOperator(operatorId, operatorKey);

let TOPIC_ID = process.env.HCS_TOPIC_ID || ""; // ONE persistent topic for the demo

// USDC (HTS) settlement config — from `npm run setup:hts`.
const USDC_TOKEN = process.env.HEDERA_USDC_TOKEN_ID || "";
const AGENT_ID = process.env.HEDERA_AGENT_ID || "";
const PROVIDER_ID = process.env.HEDERA_PROVIDER_ID || "";
const agentKey = process.env.HEDERA_AGENT_KEY
  ? parseKey(process.env.HEDERA_AGENT_KEY, process.env.HEDERA_AGENT_KEY_TYPE ?? "ED25519")
  : null;
// HBAR fallback settlement (when USDC isn't configured).
const PAYEE_ID = process.env.HEDERA_PAYEE_ID || "";
const SETTLE_HBAR = Number(process.env.HEDERA_SETTLE_HBAR ?? "0");

// ── on-chain-style price discovery: FOAMM premium rises along a curve ─────────
const BASE = 1.0,
  SLOPE = 0.0007;
const premiumAt = (k: number) => +(BASE * Math.pow(1 + SLOPE, k)).toFixed(4);
let curveIndex = 0,
  seeded = false;

const txnUrl = (id: string) => `https://hashscan.io/testnet/transaction/${id}`;
const topicUrl = (t: string) => `https://hashscan.io/testnet/topic/${t}`;

async function ensureTopic(): Promise<string> {
  if (!TOPIC_ID) {
    const resp = await new TopicCreateTransaction()
      .setTopicMemo("BoA agent-payment receipts (FOAMM-priced)")
      .setAdminKey(operatorKey.publicKey)
      .setSubmitKey(operatorKey.publicKey)
      .execute(client);
    TOPIC_ID = (await resp.getReceipt(client)).topicId!.toString();
    console.log(`[boot] created topic ${TOPIC_ID} — set HCS_TOPIC_ID=${TOPIC_ID} in Railway to keep it stable`);
  }
  if (!seeded) {
    try {
      const r = await fetch(`${MIRROR}/api/v1/topics/${TOPIC_ID}/messages?limit=1&order=desc`);
      curveIndex = (await r.json())?.messages?.[0]?.sequence_number ?? 0;
    } catch {
      /* fresh topic */
    }
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

interface Settlement {
  asset: string;
  amount: string;
  from: string;
  to: string;
  token?: string;
  txId: string;
  hashscanUrl: string;
  configured: boolean;
}

// Settle exactly `cost`: real USDC (HTS) agent->provider; else HBAR operator->payee;
// else a clearly-marked unsettled placeholder so the HCS proof loop still runs.
async function settle(cost: number): Promise<Settlement> {
  if (USDC_TOKEN && AGENT_ID && PROVIDER_ID && agentKey) {
    const units = Math.max(1, Math.round(cost * 1e6)); // USDC = 6 dp
    const txId = TransactionId.generate(AccountId.fromString(AGENT_ID));
    const tx = new TransferTransaction()
      .setTransactionId(txId)
      .addTokenTransfer(TokenId.fromString(USDC_TOKEN), AccountId.fromString(AGENT_ID), -units)
      .addTokenTransfer(TokenId.fromString(USDC_TOKEN), AccountId.fromString(PROVIDER_ID), units)
      .freezeWith(client);
    await (await (await tx.sign(agentKey)).execute(client)).getReceipt(client);
    return {
      asset: "USDC",
      amount: (units / 1e6).toFixed(6),
      from: AGENT_ID,
      to: PROVIDER_ID,
      token: USDC_TOKEN,
      txId: txId.toString(),
      hashscanUrl: txnUrl(txId.toString()),
      configured: true,
    };
  }
  if (PAYEE_ID && SETTLE_HBAR > 0) {
    const txId = TransactionId.generate(AccountId.fromString(operatorId));
    const tx = new TransferTransaction()
      .setTransactionId(txId)
      .addHbarTransfer(AccountId.fromString(operatorId), new Hbar(-SETTLE_HBAR))
      .addHbarTransfer(AccountId.fromString(PAYEE_ID), new Hbar(SETTLE_HBAR))
      .freezeWith(client);
    await (await tx.execute(client)).getReceipt(client);
    return {
      asset: "HBAR",
      amount: SETTLE_HBAR.toFixed(8),
      from: operatorId,
      to: PAYEE_ID,
      txId: txId.toString(),
      hashscanUrl: txnUrl(txId.toString()),
      configured: true,
    };
  }
  // not configured — proof loop still runs; settlement_tx is a placeholder
  const placeholder = "0x" + "00".repeat(32);
  return {
    asset: "USDC",
    amount: cost.toFixed(6),
    from: AGENT_ID || "agent",
    to: PROVIDER_ID || "provider",
    txId: placeholder,
    hashscanUrl: "",
    configured: false,
  };
}

// build a receipt whose price + cost reflect the live FOAMM premium
function buildReceipt(src: any, priceBefore: number, priceAfter: number): { unsigned: UnsignedReceipt; cost: number } {
  const base = sampleUnsignedReceipt();
  const inTok = num(src?.input_tokens, base.input_tokens);
  const outTok = num(src?.output_tokens, base.output_tokens);
  const cost = +(0.000002 * (inTok + outTok) * priceAfter).toFixed(6); // cost tracks the premium
  const unsigned: UnsignedReceipt = {
    ...base,
    agent_ens: src?.agent_ens ?? base.agent_ens,
    model: src?.model ?? base.model,
    input_tokens: inTok,
    output_tokens: outTok,
    total_cost_usdc: src?.total_cost_usdc ?? String(cost),
    settlement_tx: base.settlement_tx,
    price_before: priceBefore.toFixed(4),
    price_after: priceAfter.toFixed(4),
  };
  return { unsigned, cost: Number(unsigned.total_cost_usdc) };
}

const app = express();
app.use(cors({ origin: ORIGIN }));
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  res.json({
    ok: true,
    network: "testnet",
    topicId: TOPIC_ID || null,
    operator: operatorId,
    routerAddress: await router.getAddress(),
    settlement: USDC_TOKEN && AGENT_ID && PROVIDER_ID ? "USDC" : PAYEE_ID ? "HBAR" : "none",
    usdcToken: USDC_TOKEN || null,
    agent: AGENT_ID || null,
    provider: PROVIDER_ID || null,
    nextPremium: premiumAt(curveIndex + 1),
  });
});

// One-shot emit
app.post("/api/receipts/emit", async (req, res) => {
  try {
    const topicId = await ensureTopic();
    const before = premiumAt(curveIndex),
      after = premiumAt(curveIndex + 1);
    const { unsigned, cost } = buildReceipt(req.body, before, after);
    const settlement = await settle(cost);
    unsigned.settlement_tx = settlement.txId;
    const receipt: UsageReceipt = await signReceipt(unsigned, router);
    const submit = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(JSON.stringify(receipt))
      .execute(client);
    const seq = (await submit.getReceipt(client)).topicSequenceNumber!.toNumber();
    curveIndex += 1;
    const mn = await fetchMessageBySeq(topicId, seq);
    const readBack = JSON.parse(Buffer.from(mn.message, "base64").toString("utf8"));
    const recovered = verifyReceipt(readBack);
    const routerAddress = await router.getAddress();
    res.json({
      ok: true,
      topicId,
      sequenceNumber: seq,
      consensusTimestamp: mn.consensus_timestamp,
      receipt,
      settlement,
      routerAddress,
      recoveredSigner: recovered,
      signatureValid: recovered.toLowerCase() === routerAddress.toLowerCase(),
      bytesMatch: canonicalJSON(receipt as any) === canonicalJSON(readBack as any),
      priceBefore: receipt.price_before,
      priceAfter: receipt.price_after,
      digest: receiptDigest(receipt),
      hashscanUrl: topicUrl(topicId),
      mirrorUrl: `${MIRROR}/api/v1/topics/${topicId}/messages/${seq}`,
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// Streaming emit (SSE) — drives the step-by-step animation. EventSource is GET-only.
app.get("/api/receipts/emit/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  const send = (event: string, data: any) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  try {
    const topicId = await ensureTopic();
    const routerAddress = await router.getAddress();
    const before = premiumAt(curveIndex),
      after = premiumAt(curveIndex + 1);

    const { unsigned, cost } = buildReceipt(req.query, before, after);
    send("price", {
      priceBefore: before.toFixed(4),
      priceAfter: after.toFixed(4),
      delta: +(after - before).toFixed(4),
      receipt: unsigned,
    });

    // SETTLE — real USDC (HTS) agent -> provider for exactly the priced cost
    const settlement = await settle(cost);
    unsigned.settlement_tx = settlement.txId;
    send("settle", settlement);

    const receipt = await signReceipt(unsigned, router);
    send("sign", { router_signature: receipt.router_signature, routerAddress, recovered: verifyReceipt(receipt) });

    send("submit_start", { topicId });
    const submit = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(JSON.stringify(receipt))
      .execute(client);
    const seq = (await submit.getReceipt(client)).topicSequenceNumber!.toNumber();
    curveIndex += 1;
    send("submit", { sequenceNumber: seq, topicId });

    send("verify_start", { sequenceNumber: seq });
    const mn = await fetchMessageBySeq(topicId, seq);
    const readBack = JSON.parse(Buffer.from(mn.message, "base64").toString("utf8"));
    const recovered = verifyReceipt(readBack);

    send("done", {
      topicId,
      sequenceNumber: seq,
      consensusTimestamp: mn.consensus_timestamp,
      receipt: readBack,
      settlement,
      routerAddress,
      recoveredSigner: recovered,
      signatureValid: recovered.toLowerCase() === routerAddress.toLowerCase(),
      bytesMatch: canonicalJSON(receipt as any) === canonicalJSON(readBack as any),
      priceBefore: receipt.price_before,
      priceAfter: receipt.price_after,
      digest: receiptDigest(receipt),
      hashscanUrl: topicUrl(topicId),
      mirrorUrl: `${MIRROR}/api/v1/topics/${topicId}/messages/${seq}`,
    });
  } catch (e: any) {
    send("error", { error: String(e?.message ?? e) });
  } finally {
    res.end();
  }
});

// The growing audit log + the emitted price curve.
app.get("/api/receipts", async (_req, res) => {
  try {
    if (!TOPIC_ID) return res.json({ ok: true, topicId: null, receipts: [] });
    const r = await fetch(`${MIRROR}/api/v1/topics/${TOPIC_ID}/messages?limit=50&order=desc`);
    const j: any = await r.json();
    const receipts = (j.messages ?? []).map((m: any) => {
      let parsed: any = null;
      try {
        parsed = JSON.parse(Buffer.from(m.message, "base64").toString("utf8"));
      } catch {
        /* skip */
      }
      return {
        sequenceNumber: m.sequence_number,
        consensusTimestamp: m.consensus_timestamp,
        receipt: parsed,
        hashscanUrl: topicUrl(TOPIC_ID),
      };
    });
    res.json({ ok: true, topicId: TOPIC_ID, receipts });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

app.listen(PORT, () => console.log(`BoA Hedera API on :${PORT} (settlement: ${USDC_TOKEN ? "USDC" : PAYEE_ID ? "HBAR" : "none"})`));
