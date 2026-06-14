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

/**
 * BoA × Hedera agentic-payments API.
 *
 * Each "emit" = one paid agent tool call, end-to-end on Hedera:
 *   1. PRICE   FOAMM premium discovered on-chain (price_before -> price_after)
 *   2. SETTLE  a real HBAR micropayment operator -> payee  (settlement_tx is a live Hedera tx)
 *   3. SIGN    BoA's router signs the usage receipt
 *   4. RECORD  submit the signed receipt to one persistent HCS topic
 *   5. VERIFY  read it back from the mirror node REST API
 */

const MIRROR = process.env.HEDERA_MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";
const PORT = Number(process.env.PORT ?? 8080);
const ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";
const PAYEE = process.env.HEDERA_PAYEE_ID || "";
const SETTLE_HBAR = Number(process.env.HEDERA_SETTLE_HBAR ?? "0.01");

function parseKey(raw: string, type: string): PrivateKey {
  try {
    return type.toUpperCase() === "ECDSA" ? PrivateKey.fromStringECDSA(raw) : PrivateKey.fromStringED25519(raw);
  } catch {
    return PrivateKey.fromStringDer(raw);
  }
}
const num = (v: any, d: number) => (v === undefined || v === "" ? d : Number(v));

const operatorId = process.env.HEDERA_OPERATOR_ID!;
const operatorKey = parseKey(process.env.HEDERA_OPERATOR_KEY!, process.env.HEDERA_OPERATOR_KEY_TYPE ?? "ECDSA");
const router = new ethers.Wallet(process.env.ROUTER_PRIVATE_KEY!);
const client = Client.forTestnet().setOperator(operatorId, operatorKey);

let TOPIC_ID = process.env.HCS_TOPIC_ID || ""; // ONE persistent topic for the demo

// ── on-chain-style price discovery: FOAMM premium rises along a curve as demand accrues ──
const BASE = 1.0,
  SLOPE = 0.0007;
const premiumAt = (k: number) => +(BASE * Math.pow(1 + SLOPE, k)).toFixed(4);
let curveIndex = 0,
  seeded = false;

async function ensureTopic(): Promise<string> {
  if (!TOPIC_ID) {
    const resp = await new TopicCreateTransaction()
      .setTopicMemo("BoA agent-payment receipts (FOAMM-priced)")
      .setAdminKey(operatorKey.publicKey)
      .setSubmitKey(operatorKey.publicKey)
      .execute(client);
    TOPIC_ID = (await resp.getReceipt(client)).topicId!.toString();
    console.log(`[boot] created topic ${TOPIC_ID} — set HCS_TOPIC_ID=${TOPIC_ID} to keep it stable`);
  }
  if (!seeded) {
    try {
      const r = await fetch(`${MIRROR}/api/v1/topics/${TOPIC_ID}/messages?limit=1&order=desc`);
      curveIndex = (await r.json())?.messages?.[0]?.sequence_number ?? 0;
    } catch {}
    seeded = true;
  }
  return TOPIC_ID;
}

async function fetchMessageBySeq(topicId: string, seq: number, tries = 30, delayMs = 1500): Promise<any> {
  const url = `${MIRROR}/api/v1/topics/${topicId}/messages/${seq}`;
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url);
    if (r.ok) return r.json();
    await new Promise((s) => setTimeout(s, delayMs));
  }
  throw new Error(`mirror node timeout for ${url}`);
}

// 0.0.x@s.n -> hashscan transaction url (0.0.x-s-n)
function txHashscan(id: string): string {
  const [acct, ts] = id.split("@");
  return `https://hashscan.io/testnet/transaction/${acct}-${(ts ?? "").replace(".", "-")}`;
}

// SETTLE: a real HBAR micropayment operator -> payee. Returns the live Hedera tx id.
async function settleOnHedera(): Promise<{ txId: string; hashscanUrl: string; amountHbar: number } | null> {
  if (!PAYEE) return null;
  const tx = await new TransferTransaction()
    .addHbarTransfer(operatorId, new Hbar(-SETTLE_HBAR))
    .addHbarTransfer(PAYEE, new Hbar(SETTLE_HBAR))
    .execute(client);
  await tx.getReceipt(client); // wait for consensus (SUCCESS)
  const txId = tx.transactionId!.toString();
  return { txId, hashscanUrl: txHashscan(txId), amountHbar: SETTLE_HBAR };
}

function buildReceipt(src: any, priceBefore: number, priceAfter: number, settlementTx?: string): UnsignedReceipt {
  const base = sampleUnsignedReceipt();
  const inTok = num(src?.input_tokens, base.input_tokens);
  const outTok = num(src?.output_tokens, base.output_tokens);
  const cost = +(0.000002 * (inTok + outTok) * priceAfter).toFixed(6); // cost tracks the premium
  return {
    ...base,
    agent_ens: src?.agent_ens ?? base.agent_ens,
    model: src?.model ?? base.model,
    input_tokens: inTok,
    output_tokens: outTok,
    total_cost_usdc: src?.total_cost_usdc ?? String(cost),
    settlement_tx: settlementTx ?? src?.settlement_tx ?? base.settlement_tx,
    price_before: priceBefore.toFixed(4),
    price_after: priceAfter.toFixed(4),
  };
}

const topicUrl = (t: string) => `https://hashscan.io/testnet/topic/${t}`;

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
    payee: PAYEE || null,
    settleHbar: PAYEE ? SETTLE_HBAR : 0,
    nextPremium: premiumAt(curveIndex + 1),
  });
});

// One-shot emit
app.post("/api/receipts/emit", async (req, res) => {
  try {
    const topicId = await ensureTopic();
    const before = premiumAt(curveIndex),
      after = premiumAt(curveIndex + 1);
    const settle = await settleOnHedera();
    const receipt: UsageReceipt = await signReceipt(buildReceipt(req.body, before, after, settle?.txId), router);
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
      routerAddress,
      recoveredSigner: recovered,
      signatureValid: recovered.toLowerCase() === routerAddress.toLowerCase(),
      bytesMatch: canonicalJSON(receipt as any) === canonicalJSON(readBack as any),
      priceBefore: receipt.price_before,
      priceAfter: receipt.price_after,
      settlement: settle, // { txId, hashscanUrl, amountHbar } | null
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
  const send = (event: string, data: any) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  try {
    const topicId = await ensureTopic();
    const routerAddress = await router.getAddress();
    const before = premiumAt(curveIndex),
      after = premiumAt(curveIndex + 1);

    send("price", {
      priceBefore: before.toFixed(4),
      priceAfter: after.toFixed(4),
      delta: +(after - before).toFixed(4),
    });

    const settle = await settleOnHedera();
    send("settle", settle ?? { skipped: true });

    const unsigned = buildReceipt(req.query, before, after, settle?.txId);
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
      routerAddress,
      recoveredSigner: recovered,
      signatureValid: recovered.toLowerCase() === routerAddress.toLowerCase(),
      bytesMatch: canonicalJSON(receipt as any) === canonicalJSON(readBack as any),
      priceBefore: receipt.price_before,
      priceAfter: receipt.price_after,
      settlement: settle,
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
      } catch {}
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

app.listen(PORT, () => console.log(`BoA Hedera API on :${PORT}  (payee=${PAYEE || "none"}, settle=${SETTLE_HBAR}ℏ)`));
