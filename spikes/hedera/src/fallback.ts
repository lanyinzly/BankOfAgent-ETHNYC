import "dotenv/config";
import { ethers } from "ethers";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  sampleUnsignedReceipt,
  signReceipt,
  verifyReceipt,
  receiptDigest,
  type UsageReceipt,
} from "./receipt";

/**
 * Fallback proof rail — the retreat for when HCS is unreachable.
 *
 * Same router-signed receipt, but instead of submitting to HCS we compute its
 * sha-256 digest and persist {receipt, digest} to a local JSON "DB". The digest is
 * the immutability anchor you'd later write to the agent's ENS text record.
 *
 * Talk track: the proof rail is HCS; the retreat is to write the digest to a DB /
 * ENS, and HCS stays the *planned* proof rail. This script has zero network deps,
 * so it always runs green and demonstrates the receipt + digest end to end.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "data", "receipts.json");

interface DbRecord {
  receipt: UsageReceipt;
  digest: string;
  alg: string;
  anchored_at: string;
}

function routerWallet(): ethers.Wallet {
  const pk = process.env.ROUTER_PRIVATE_KEY;
  if (pk && !/^0x0+$/.test(pk)) return new ethers.Wallet(pk);
  const w = ethers.Wallet.createRandom();
  console.log("[router] no ROUTER_PRIVATE_KEY set — generated an ephemeral router key for this run.");
  return new ethers.Wallet(w.privateKey);
}

function loadDb(): DbRecord[] {
  if (!existsSync(DB_PATH)) return [];
  try {
    return JSON.parse(readFileSync(DB_PATH, "utf8")) as DbRecord[];
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const router = routerWallet();
  const routerAddr = await router.getAddress();

  console.log("\n=== BoA fallback proof rail (local signed-digest receipt) ===");
  console.log("(used when HCS is unreachable: same router-signed receipt, anchored by sha-256 digest to a local DB / later ENS)");
  console.log(`router signer address: ${routerAddr}`);

  // Build + sign the same receipt schema the HCS rail uses.
  const receipt = await signReceipt(sampleUnsignedReceipt(), router);
  const digest = receiptDigest(receipt);

  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = loadDb();
  const record: DbRecord = { receipt, digest, alg: "sha-256", anchored_at: new Date().toISOString() };
  db.push(record);
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

  console.log(`\n[write] appended receipt to ${DB_PATH} (now ${db.length} record(s))`);
  console.log(`[write] digest (immutability anchor → would be written to agent ENS text record): ${digest}`);

  // Read it back and verify the digest recomputes and the signature still recovers the router.
  const last = loadDb().at(-1)!;
  const recomputed = receiptDigest(last.receipt);
  const digestOk = recomputed === last.digest;
  const recovered = verifyReceipt(last.receipt);
  const sigOk = recovered.toLowerCase() === routerAddr.toLowerCase();

  console.log("\n[read] re-read last record from DB:");
  console.log(JSON.stringify(last, null, 2));

  console.log("\n=== RESULT ===");
  console.log(`digest recompute: ${digestOk ? "MATCH" : "MISMATCH"} (${recomputed})`);
  console.log(`router signature: ${sigOk ? `VALID (recovered ${recovered})` : "INVALID"}`);

  if (digestOk && sigOk) {
    console.log("\nPASS ✅  fallback rail works: router-signed receipt + sha-256 digest persisted and verified locally.");
    process.exit(0);
  }
  console.log("\nFAIL ❌");
  process.exit(1);
}

main().catch((e) => {
  console.error("\nFAIL ❌  fallback threw:", e);
  process.exit(1);
});
