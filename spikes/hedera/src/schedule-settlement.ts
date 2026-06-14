import "dotenv/config";
import {
  Client,
  PrivateKey,
  TransferTransaction,
  ScheduleCreateTransaction,
  Timestamp,
  AccountId,
  Hbar,
} from "@hashgraph/sdk";

/**
 * Scheduled / recurring settlement — Hedera Scheduled Transactions (HIP-423).
 *
 * BoA agents often run on a retainer: pay the provider every period, not per call.
 * This queues the *next* period's settlement as a long-term scheduled transaction that
 * auto-executes at a future time (`setWaitForExpiry(true)`), no human in the loop.
 * "Recurring" = re-arm one of these each period (cron / the server can do it after each
 * execution). Single-execution is the Hedera primitive; we compose recurrence on top.
 *
 * Default settles HBAR operator → payee (operator is sender + payer, so its signature
 * — applied automatically by the client — is sufficient and it executes at expiry).
 * USDC agent→provider scheduling additionally needs the agent's ScheduleSign (noted below).
 *
 * Needs open gRPC egress (laptop / Railway).
 * Run: cd spikes/hedera && npm run schedule -- [minutesFromNow] [hbarAmount]
 */

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
  console.error("\n[blocked] set HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY in .env (funded testnet account). Needs open gRPC egress.\n");
  process.exit(2);
}
const operatorKey = parseKey(operatorRaw, process.env.HEDERA_OPERATOR_KEY_TYPE ?? "ED25519");
const client = Client.forTestnet().setOperator(operatorId, operatorKey);

const PAYEE_ID = process.env.HEDERA_PROVIDER_ID || process.env.HEDERA_PAYEE_ID || "";

async function main(): Promise<void> {
  if (!PAYEE_ID) throw new Error("set HEDERA_PROVIDER_ID (from `npm run setup:hts`) or HEDERA_PAYEE_ID — the payee for the scheduled settlement");

  const minutes = Number(process.argv[2] ?? "10"); // when it should execute
  const amount = Number(process.argv[3] ?? "0.05"); // HBAR per period
  const MAX_DAYS = 62; // HIP-423 cap
  if (minutes / (60 * 24) > MAX_DAYS) throw new Error(`expiration must be within ${MAX_DAYS} days`);

  const execAt = new Date(Date.now() + minutes * 60_000);

  // The inner settlement (do NOT freeze it — ScheduleCreate wraps it).
  const inner = new TransferTransaction()
    .addHbarTransfer(AccountId.fromString(operatorId!), new Hbar(-amount))
    .addHbarTransfer(AccountId.fromString(PAYEE_ID), new Hbar(amount));

  console.log("\n=== BoA × Hedera — scheduled recurring settlement (HIP-423) ===");
  console.log(`payer/operator: ${operatorId}   payee: ${PAYEE_ID}`);
  console.log(`queue ${amount} HBAR to auto-execute at ${execAt.toISOString()} (~${minutes} min)`);

  const resp = await new ScheduleCreateTransaction()
    .setScheduledTransaction(inner)
    .setScheduleMemo(`BoA retainer settlement — ${amount} HBAR @ ${execAt.toISOString()}`)
    .setAdminKey(operatorKey.publicKey) // lets us delete it before execution if needed
    .setExpirationTime(Timestamp.fromDate(execAt))
    .setWaitForExpiry(true) // long-term: execute at expiry, not when sigs arrive
    .execute(client);
  const scheduleId = (await resp.getReceipt(client)).scheduleId!.toString();

  console.log("\n=== RESULT ===");
  console.log(`scheduleId: ${scheduleId}`);
  console.log(`hashscan:   https://hashscan.io/testnet/schedule/${scheduleId}`);
  console.log(`mirror:     https://testnet.mirrornode.hedera.com/api/v1/schedules/${scheduleId}`);
  console.log(`executes:   ~${execAt.toISOString()} (auto, no further action)`);
  console.log("\nRecurring: after it executes, re-arm the next period (cron, or the API after each settle).");
  console.log("USDC variant: schedule the agent→provider token transfer and collect the agent's");
  console.log("signature with ScheduleSignTransaction before expiry.");
  console.log("\nPASS ✅  next settlement is queued on Hedera and will execute itself.");
  process.exit(0);
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
