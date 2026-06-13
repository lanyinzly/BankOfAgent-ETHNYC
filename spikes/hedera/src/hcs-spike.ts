import "dotenv/config";
import {
  Client,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
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
 * BoA HCS proof-rail spike — go/no-go gate.
 *
 * One command: create a topic → submit a router-signed usage receipt → read it
 * back from the mirror node REST API → assert the round-trip is byte-identical
 * and the router signature still verifies. Prints topicId, sequenceNumber and the
 * decoded JSON, then PASS/FAIL.
 */

const MIRROR = process.env.HEDERA_MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";

function parseKey(raw: string, type: string): PrivateKey {
  try {
    return type === "ECDSA" ? PrivateKey.fromStringECDSA(raw) : PrivateKey.fromStringED25519(raw);
  } catch {
    return PrivateKey.fromStringDer(raw); // tolerate DER-encoded strings of either type
  }
}

function loadOperator(): { id: string; key: PrivateKey } {
  const id = process.env.HEDERA_OPERATOR_ID;
  const raw = process.env.HEDERA_OPERATOR_KEY;
  const type = (process.env.HEDERA_OPERATOR_KEY_TYPE ?? "ED25519").toUpperCase();
  if (!id || !raw || id.startsWith("0.0.xxx") || raw.startsWith("302e020100300506032b657004220420...")) {
    console.error(
      "\n[blocked] Missing/placeholder HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY.\n" +
        "  → Get a funded testnet account from https://portal.hedera.com (or the no-login\n" +
        "    faucet https://portal.hedera.com/faucet), then: cp .env.example .env, fill it\n" +
        "    in, and re-run `npm run spike`.\n" +
        "  → No credentials handy? `npm run fallback` proves the same receipt via the\n" +
        "    local digest rail, and `npm run verify-read` proves the live mirror-node read.\n",
    );
    process.exit(2);
  }
  return { id, key: parseKey(raw, type) };
}

function routerWallet(): ethers.Wallet {
  const pk = process.env.ROUTER_PRIVATE_KEY;
  if (pk && !/^0x0+$/.test(pk)) return new ethers.Wallet(pk);
  const w = ethers.Wallet.createRandom();
  console.log("[router] no ROUTER_PRIVATE_KEY set — generated an ephemeral router key for this run.");
  return new ethers.Wallet(w.privateKey);
}

/** Poll the mirror node REST API for a single message by sequence number (mirror lags a few seconds). */
async function fetchMessageBySeq(topicId: string, seq: number, tries = 25, delayMs = 2000): Promise<any> {
  const url = `${MIRROR}/api/v1/topics/${topicId}/messages/${seq}`;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`mirror node did not return ${url} after ${tries} tries`);
}

async function main(): Promise<void> {
  const { id, key } = loadOperator();
  const router = routerWallet();
  const routerAddr = await router.getAddress();
  const client = Client.forTestnet().setOperator(id, key);

  console.log("\n=== BoA HCS proof-rail spike (Hedera testnet) ===");
  console.log(`operator:              ${id}`);
  console.log(`router signer address: ${routerAddr}`);
  console.log(`mirror node:           ${MIRROR}`);

  // 1) Build + router-sign the usage receipt (this is what makes it a *claim*, not a log line).
  const receipt: UsageReceipt = await signReceipt(sampleUnsignedReceipt(), router);
  console.log("\n[1] router-signed usage receipt:");
  console.log(JSON.stringify(receipt, null, 2));
  console.log(`    recovered signer (anyone can verify): ${verifyReceipt(receipt)}`);

  // 2) Create the HCS topic. Admin + submit keys gate it to the operator/router key,
  //    so only BoA can append receipts (per the hedera-dev native-services HCS skill).
  const createResp = await new TopicCreateTransaction()
    .setTopicMemo("BoA usage-receipt proof rail (Sprint 0 spike)")
    .setAdminKey(key.publicKey)
    .setSubmitKey(key.publicKey)
    .execute(client);
  const topicId = (await createResp.getReceipt(client)).topicId!;
  console.log(`\n[2] created topic: ${topicId.toString()}`);

  // 3) Submit the receipt as an HCS message.
  const submitResp = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(JSON.stringify(receipt))
    .execute(client);
  const seq = (await submitResp.getReceipt(client)).topicSequenceNumber!.toNumber();
  console.log(`[3] submitted receipt → consensus sequence number: ${seq}`);

  // 4) Read it back from the mirror node REST API and decode (base64 → utf8 → JSON).
  console.log(`\n[4] reading back: ${MIRROR}/api/v1/topics/${topicId.toString()}/messages/${seq}`);
  const mn = await fetchMessageBySeq(topicId.toString(), seq);
  const decoded = Buffer.from(mn.message, "base64").toString("utf8");
  const readBack: UsageReceipt = JSON.parse(decoded);
  console.log(`    sequence_number:     ${mn.sequence_number}`);
  console.log(`    consensus_timestamp: ${mn.consensus_timestamp}`);
  console.log("    decoded message:");
  console.log(JSON.stringify(readBack, null, 2));

  // 5) Verify: byte-identical round-trip + signature still recovers the router.
  const bytesMatch = canonicalJSON(receipt as any) === canonicalJSON(readBack as any);
  const recovered = verifyReceipt(readBack);
  const sigOk = recovered.toLowerCase() === routerAddr.toLowerCase();

  console.log("\n=== RESULT ===");
  console.log(`topicId:          ${topicId.toString()}`);
  console.log(`sequenceNumber:   ${mn.sequence_number}`);
  console.log(`receipt digest:   ${receiptDigest(receipt)}`);
  console.log(`bytes round-trip: ${bytesMatch ? "MATCH" : "MISMATCH"}`);
  console.log(`router signature: ${sigOk ? `VALID (recovered ${recovered})` : "INVALID"}`);
  console.log(`hashscan:         https://hashscan.io/testnet/topic/${topicId.toString()}`);

  if (bytesMatch && sigOk) {
    console.log("\nPASS ✅  proof rail works: a router-signed receipt was submitted to HCS and read back identical from the mirror node.");
    process.exit(0);
  }
  console.log("\nFAIL ❌  round-trip or signature mismatch.");
  process.exit(1);
}

main().catch((e) => {
  const msg = String(e?.message ?? e);
  if (/DEADLINE_EXCEEDED|GrpcServiceError|ECONNREFUSED|ETIMEDOUT|max attempts/i.test(msg)) {
    console.error(
      "\nFAIL ❌  could not reach a Hedera consensus node (gRPC).\n" +
        "  The transaction was built and router-signed fine — this is a NETWORK egress block,\n" +
        "  not a code/credentials problem: consensus nodes speak gRPC on ports 50211/50212,\n" +
        "  but this environment only allows outbound HTTPS/443. Mirror-node reads work;\n" +
        "  consensus submission does not.\n" +
        "  → Run this spike from a host with open egress (your local terminal): the same .env\n" +
        "    + `npm run spike` completes the create→submit→read round-trip in ~10s.\n" +
        `  underlying error: ${msg}\n`,
    );
  } else {
    console.error("\nFAIL ❌  spike threw:", e);
  }
  process.exit(1);
});
