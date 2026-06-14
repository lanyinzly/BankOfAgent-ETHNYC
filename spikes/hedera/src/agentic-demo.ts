import "dotenv/config";
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
  type UsageReceipt,
} from "./receipt";

/**
 * Agentic-payments demo — headless, one command, evidence-capturing.
 *
 * The CLI twin of `server.ts`'s emit endpoint: runs ONE full agent-payment loop on
 * Hedera testnet and prints every artifact (HashScan links included) so you can paste
 * the proof into the README / a demo:
 *
 *   PRICE  (FOAMM premium)
 *   SETTLE (real USDC HTS transfer agent→provider, or HBAR fallback)  ← financial op on Hedera
 *   SIGN   (router signs the usage receipt)
 *   RECORD (append the signed receipt to an HCS topic)               ← verifiable audit trail
 *   VERIFY (read it back from the mirror node, byte-identical + signature valid)
 *
 * Needs open gRPC egress (a normal terminal / Railway), like `npm run spike`.
 * Run: cd spikes/hedera && npm run demo:agentic
 */

const MIRROR = process.env.HEDERA_MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";

function parseKey(raw: string, type = "ED25519"): PrivateKey {
  try {
    return type.toUpperCase() === "ECDSA" ? PrivateKey.fromStringECDSA(raw) : PrivateKey.fromStringED25519(raw);
  } catch {
    return PrivateKey.fromStringDer(raw);
  }
}

const operatorId = process.env.HEDERA_OPERATOR_ID;
const operatorRaw = process.env.HEDERA_OPERATOR_KEY;
if (!operatorId || !operatorRaw || operatorId.startsWith("0.0.xxx")) {
  console.error(
    "\n[blocked] set HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY in .env (funded testnet account).\n" +
      "  This demo submits real transactions, so it needs open gRPC egress (run on a laptop / Railway,\n" +
      "  not inside the Claude-Code-web sandbox). See README → 'The sandbox egress blocker'.\n",
  );
  process.exit(2);
}
const operatorKey = parseKey(operatorRaw, process.env.HEDERA_OPERATOR_KEY_TYPE ?? "ED25519");
const router = new ethers.Wallet(
  process.env.ROUTER_PRIVATE_KEY && !/^0x0+$/.test(process.env.ROUTER_PRIVATE_KEY)
    ? process.env.ROUTER_PRIVATE_KEY
    : ethers.Wallet.createRandom().privateKey,
);
const client = Client.forTestnet().setOperator(operatorId, operatorKey);

// USDC (HTS) settlement config — produced by `npm run setup:hts`.
const USDC_TOKEN = process.env.HEDERA_USDC_TOKEN_ID || "";
const AGENT_ID = process.env.HEDERA_AGENT_ID || "";
const PROVIDER_ID = process.env.HEDERA_PROVIDER_ID || "";
const agentKey = process.env.HEDERA_AGENT_KEY ? parseKey(process.env.HEDERA_AGENT_KEY, process.env.HEDERA_AGENT_KEY_TYPE ?? "ED25519") : null;
// HBAR fallback settlement (when USDC isn't configured).
const PAYEE_ID = process.env.HEDERA_PAYEE_ID || "";
const SETTLE_HBAR = Number(process.env.HEDERA_SETTLE_HBAR ?? "0.01");

const txnUrl = (id: string) => `https://hashscan.io/testnet/transaction/${id}`;
const topicUrl = (t: string) => `https://hashscan.io/testnet/topic/${t}`;
const BASE = 1.0, SLOPE = 0.0007;
const premiumAt = (k: number) => +(BASE * Math.pow(1 + SLOPE, k)).toFixed(4);

async function fetchMessageBySeq(topicId: string, seq: number, tries = 30, delayMs = 1500): Promise<any> {
  const url = `${MIRROR}/api/v1/topics/${topicId}/messages/${seq}`;
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url);
    if (r.ok) return r.json();
    await new Promise((s) => setTimeout(s, delayMs));
  }
  throw new Error(`mirror node timeout for ${url}`);
}

interface Settlement { asset: string; amount: string; from: string; to: string; txId: string; hashscanUrl: string; configured: boolean }

// Settle exactly `cost`: real USDC (HTS) agent→provider; else HBAR operator→payee.
async function settle(cost: number): Promise<Settlement> {
  if (USDC_TOKEN && AGENT_ID && PROVIDER_ID && agentKey) {
    const units = Math.max(1, Math.round(cost * 1e6)); // USDC 6dp
    const txId = TransactionId.generate(AccountId.fromString(AGENT_ID));
    const tx = await new TransferTransaction()
      .setTransactionId(txId)
      .addTokenTransfer(TokenId.fromString(USDC_TOKEN), AccountId.fromString(AGENT_ID), -units)
      .addTokenTransfer(TokenId.fromString(USDC_TOKEN), AccountId.fromString(PROVIDER_ID), units)
      .freezeWith(client)
      .sign(agentKey);
    await (await tx.execute(client)).getReceipt(client);
    return { asset: "USDC", amount: (units / 1e6).toFixed(6), from: AGENT_ID, to: PROVIDER_ID, txId: txId.toString(), hashscanUrl: txnUrl(txId.toString()), configured: true };
  }
  const to = PROVIDER_ID || PAYEE_ID;
  if (to) {
    const txId = TransactionId.generate(AccountId.fromString(operatorId!));
    const tx = new TransferTransaction()
      .setTransactionId(txId)
      .addHbarTransfer(AccountId.fromString(operatorId!), new Hbar(-SETTLE_HBAR))
      .addHbarTransfer(AccountId.fromString(to), new Hbar(SETTLE_HBAR))
      .freezeWith(client);
    await (await tx.execute(client)).getReceipt(client);
    return { asset: "HBAR", amount: SETTLE_HBAR.toFixed(8), from: operatorId!, to, txId: txId.toString(), hashscanUrl: txnUrl(txId.toString()), configured: true };
  }
  throw new Error("no settlement target — run `npm run setup:hts` (USDC) or set HEDERA_PAYEE_ID (HBAR)");
}

async function main(): Promise<void> {
  console.log("\n=== BoA × Hedera — agentic-payments demo (one full loop, live testnet) ===");
  console.log(`operator: ${operatorId}   router: ${await router.getAddress()}`);
  console.log(`settlement: ${USDC_TOKEN ? `USDC ${USDC_TOKEN} (agent ${AGENT_ID} → provider ${PROVIDER_ID})` : `HBAR (operator → ${PROVIDER_ID || PAYEE_ID || "?"})`}`);

  // RECORD topic (reuse a stable one if provided, else create)
  let topicId = process.env.HCS_TOPIC_ID || "";
  if (!topicId) {
    const resp = await new TopicCreateTransaction()
      .setTopicMemo("BoA agent-payment receipts (FOAMM-priced)")
      .setAdminKey(operatorKey.publicKey)
      .setSubmitKey(operatorKey.publicKey)
      .execute(client);
    topicId = (await resp.getReceipt(client)).topicId!.toString();
    console.log(`[topic] created ${topicId}  (set HCS_TOPIC_ID to reuse it)`);
  }

  // PRICE — FOAMM premium along the curve (seed from the topic's current length)
  let k = 0;
  try { k = (await (await fetch(`${MIRROR}/api/v1/topics/${topicId}/messages?limit=1&order=desc`)).json())?.messages?.[0]?.sequence_number ?? 0; } catch {}
  const priceBefore = premiumAt(k), priceAfter = premiumAt(k + 1);
  const cost = +(0.004 * priceBefore).toFixed(6);
  console.log(`[price]  FOAMM premium ${priceBefore} → ${priceAfter}; call cost ${cost} USDC`);

  // SETTLE — real financial operation on Hedera
  const s = await settle(cost);
  console.log(`[settle] ${s.amount} ${s.asset}  ${s.from} → ${s.to}\n         tx ${s.txId}\n         ${s.hashscanUrl}`);

  // SIGN — router-signed usage receipt; settlement_tx = the Hedera settlement tx id
  const receipt: UsageReceipt = await signReceipt(
    { ...sampleUnsignedReceipt(), total_cost_usdc: cost.toFixed(6), settlement_tx: s.txId, price_before: priceBefore.toFixed(4), price_after: priceAfter.toFixed(4) },
    router,
  );

  // RECORD — append to HCS
  const submit = await new TopicMessageSubmitTransaction().setTopicId(TopicId.fromString(topicId)).setMessage(JSON.stringify(receipt)).execute(client);
  const seq = (await submit.getReceipt(client)).topicSequenceNumber!.toNumber();
  console.log(`[record] HCS topic ${topicId} ← receipt, consensus sequence #${seq}`);

  // VERIFY — read back from the mirror node
  const mn = await fetchMessageBySeq(topicId, seq);
  const readBack: UsageReceipt = JSON.parse(Buffer.from(mn.message, "base64").toString("utf8"));
  const bytesMatch = canonicalJSON(receipt as any) === canonicalJSON(readBack as any);
  const recovered = verifyReceipt(readBack);
  const sigOk = recovered.toLowerCase() === (await router.getAddress()).toLowerCase();

  console.log("\n=== RESULT (paste into README/DEMO as live evidence) ===");
  console.log(`settlement (${s.asset}): ${s.txId}`);
  console.log(`  hashscan:   ${s.hashscanUrl}`);
  console.log(`HCS topic:    ${topicId}  seq ${seq}`);
  console.log(`  hashscan:   ${topicUrl(topicId)}`);
  console.log(`  mirror:     ${MIRROR}/api/v1/topics/${topicId}/messages/${seq}`);
  console.log(`receipt digest: ${receiptDigest(receipt)}`);
  console.log(`bytes round-trip: ${bytesMatch ? "MATCH" : "MISMATCH"}   router signature: ${sigOk ? `VALID (${recovered})` : "INVALID"}`);

  if (s.configured && bytesMatch && sigOk) {
    console.log("\nPASS ✅  one agent call: priced → settled on Hedera → signed → recorded on HCS → read back identical.");
    process.exit(0);
  }
  console.log("\nFAIL ❌  see above.");
  process.exit(1);
}

main().catch((e) => {
  const msg = String(e?.message ?? e);
  if (/DEADLINE_EXCEEDED|GrpcServiceError|ECONNREFUSED|ETIMEDOUT|max attempts/i.test(msg)) {
    console.error(`\nFAIL ❌  gRPC egress blocked — run from an open-egress host (laptop / Railway). ${msg}`);
  } else {
    console.error("\nFAIL ❌ ", e);
  }
  process.exit(1);
});
