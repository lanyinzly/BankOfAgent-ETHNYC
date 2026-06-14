// BoA spine demo — runs the full closed loop and prints the key state at each step:
//
//   buy membership (price moves up the FOAMM curve)
//     -> agent A calls /v1/chat/completions  (one signed usage receipt)
//     -> transfer the voucher to agent B
//     -> agent B redeems the voucher into quota
//     -> agent B makes a successful call
//
// Run the relay first (`node relay` / `npm start`) then `npm run demo`. If no relay
// is reachable, the demo boots one in-process so it always runs.

import { loadConfig } from "./src/config.ts";
import { buildApp } from "./src/server.ts";

const AGENT_A = { ens: "agent-a.boa.eth", key: "boa-sk-agent-a" };
const AGENT_B = { ens: "agent-b.boa.eth", key: "boa-sk-agent-b" };

let BASE = process.env.BOA_RELAY_URL ?? `http://127.0.0.1:${loadConfig().port}`;
let inProcServer: any = null;

// ---- tiny pretty helpers ----
const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
};
function step(n: number, title: string) {
  console.log("\n" + c.bold(c.cyan(`▌ step ${n}  ${title}`)));
}
function kv(k: string, v: unknown) {
  console.log(`    ${c.dim(k.padEnd(20))} ${typeof v === "string" ? v : JSON.stringify(v)}`);
}

async function reachable(base: string): Promise<boolean> {
  try {
    const r = await fetch(base + "/health", { signal: AbortSignal.timeout(800) });
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureRelay() {
  if (await reachable(BASE)) {
    console.log(c.dim(`using running relay at ${BASE}`));
    return;
  }
  console.log(c.dim(`no relay reachable — booting one in-process...`));
  const cfg = loadConfig();
  const { app } = buildApp(cfg);
  await new Promise<void>((resolve) => {
    inProcServer = app.listen(0, () => resolve());
  });
  const port = inProcServer.address().port;
  BASE = `http://127.0.0.1:${port}`;
  console.log(c.dim(`in-process relay at ${BASE}`));
}

interface CallOpts {
  token?: string;
  body?: unknown;
}
async function api(method: string, path: string, opts: CallOpts = {}): Promise<{ status: number; json: any; headers: Headers }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json, headers: res.headers };
}

async function main() {
  console.log(c.bold("\n══ Bank of Agent — spine demo ═══════════════════════════════════"));
  await ensureRelay();

  const health = await api("GET", "/health");
  kv("relay", `${health.json.service}  chain=${health.json.chainMode}  upstream=${health.json.upstream}`);
  kv("router (proof)", health.json.routerAddress);

  // identities
  step(0, "identities (ENS stub)");
  for (const a of [AGENT_A, AGENT_B]) {
    const id = await api("GET", `/boa/identity?agent=${a.ens}`);
    kv(a.ens, id.json.address);
  }

  // price before
  step(1, "FOAMM price BEFORE any buy");
  let price = (await api("GET", `/boa/price?market=boa-membership`)).json;
  kv("sold", price.sold);
  kv("currentPremium", `${price.currentPremium} ${price.unit}`);
  kv("nextPremium", `${price.nextPremium} ${price.unit}`);

  // agent A buys membership
  step(2, "agent A buys membership (wrap) — watch the curve move");
  const buy1 = await api("POST", "/boa/membership/buy", { body: { agent: AGENT_A.ens, market: "boa-membership" } });
  kv("tokenId", buy1.json.tokenId);
  kv("priceBefore", `${buy1.json.priceBefore} ${buy1.json.unit}`);
  kv("priceAfter", c.green(`${buy1.json.priceAfter} ${buy1.json.unit}  ⬆ curve moved`));
  kv("pricePaid", `${buy1.json.pricePaid} ${buy1.json.unit}`);
  kv("quotaGranted", `${buy1.json.quotaUsdc} USDC`);
  if (buy1.json.txHash) kv("txHash", buy1.json.txHash);
  const tokenId = buy1.json.tokenId;

  price = (await api("GET", `/boa/price`)).json;
  kv("price.now sold", price.sold);
  kv("price.now current", `${price.currentPremium} ${price.unit}`);

  // agent A makes a metered call
  step(3, "agent A calls /v1/chat/completions (OpenAI-compatible)");
  const call1 = await api("POST", "/v1/chat/completions", {
    token: AGENT_A.key,
    body: {
      model: "boa-stub-echo",
      messages: [{ role: "user", content: "In one sentence: why is AI inference a tradable commodity?" }],
    },
  });
  kv("status", call1.status);
  kv("model", call1.json.model);
  kv("assistant", '"' + (call1.json.choices?.[0]?.message?.content ?? "").slice(0, 90) + '..."');
  const usage1 = JSON.parse(call1.headers.get("x-boa-usage") || "{}");
  console.log(c.dim("    x-boa-usage (signed usage receipt):"));
  kv("  request_id", usage1.request_id);
  kv("  membership_token", usage1.membership_token_id);
  kv("  tokens in/out", `${usage1.input_tokens}/${usage1.output_tokens}`);
  kv("  total_cost_usdc", usage1.total_cost_usdc);
  kv("  settlement_tx", (usage1.settlement_tx || "").slice(0, 26) + "...");
  kv("  router_signature", c.yellow((usage1.router_signature || "").slice(0, 26) + "..."));
  kv("  quota_remaining", `${usage1.quota_remaining_usdc} USDC`);

  // usage receipts for A
  step(4, "usage receipts for agent A (proof rail = signed JSONL, later Hedera HCS)");
  const usageA = await api("GET", `/boa/usage?agent=${AGENT_A.ens}`);
  kv("receipt count", usageA.json.length);
  kv("latest receipt", usageA.json[usageA.json.length - 1]);

  // transfer voucher A -> B
  step(5, "agent A transfers the voucher to agent B");
  const xfer = await api("POST", "/boa/membership/transfer", { body: { tokenId, from: AGENT_A.ens, to: AGENT_B.ens } });
  kv("tokenId", xfer.json.tokenId);
  kv("from -> to", `${xfer.json.from}  →  ${xfer.json.to}`);
  if (xfer.json.txHash) kv("txHash", xfer.json.txHash);

  // before redeem: can B already call? (it owns the voucher now)
  // redeem voucher into quota
  step(6, "agent B redeems the voucher into quota (unwrap)");
  const redeem = await api("POST", "/boa/membership/redeem", { body: { agent: AGENT_B.ens, tokenId } });
  kv("tokenId burned", redeem.json.tokenId);
  kv("refund", `${redeem.json.refund} ${redeem.json.unit}`);
  kv("quotaCredited", c.green(`${redeem.json.quotaCreditedUsdc} USDC  → standalone quota`));
  if (redeem.json.txHash) kv("txHash", redeem.json.txHash);

  price = (await api("GET", `/boa/price`)).json;
  kv("price.now sold", `${price.sold}  ${c.dim("(voucher burned, supply back down)")}`);
  kv("price.now current", `${price.currentPremium} ${price.unit}`);

  // agent B makes a successful call using redeemed quota
  step(7, "agent B calls /v1/chat/completions (using redeemed quota)");
  const call2 = await api("POST", "/v1/chat/completions", {
    token: AGENT_B.key,
    body: {
      model: "boa-stub-echo",
      messages: [{ role: "user", content: "Confirm: the redeemed voucher gives me callable quota." }],
    },
  });
  kv("status", call2.status === 200 ? c.green(`${call2.status} OK`) : c.yellow(String(call2.status)));
  kv("assistant", '"' + (call2.json.choices?.[0]?.message?.content ?? "").slice(0, 90) + '..."');
  const usage2 = JSON.parse(call2.headers.get("x-boa-usage") || "{}");
  kv("membership_token", usage2.membership_token_id ?? "null (standalone quota)");
  kv("total_cost_usdc", usage2.total_cost_usdc);
  kv("router_signature", c.yellow((usage2.router_signature || "").slice(0, 26) + "..."));
  kv("quota_remaining", `${usage2.quota_remaining_usdc} USDC`);

  // summary
  console.log(c.bold(c.green("\n✔ closed loop complete")) + c.dim("  buy → call → transfer → redeem → second agent calls"));
  const allA = (await api("GET", `/boa/usage?agent=${AGENT_A.ens}`)).json.length;
  const allB = (await api("GET", `/boa/usage?agent=${AGENT_B.ens}`)).json.length;
  kv("receipts: A / B", `${allA} / ${allB}`);
  console.log("");

  if (inProcServer) {
    await new Promise<void>((r) => inProcServer.close(() => r()));
  }
}

main().catch((e) => {
  console.error("\ndemo failed:", e);
  if (inProcServer) inProcServer.close();
  process.exit(1);
});
