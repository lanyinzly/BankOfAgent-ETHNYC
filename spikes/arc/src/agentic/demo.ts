// BoA agentic settlement demo on Arc — one command runs all three legs:
//   1) Circle Programmable Wallets for agents   (real if CIRCLE_API_KEY set, else simulated)
//   2) CCTP V2 bridge: USDC Base Sepolia -> Arc (real if CCTP_LIVE=1, else simulated)
//   3) x402 pay-per-usage to the relay          (REAL on-chain on Arc)
//
// Run: npm run agentic
import "dotenv/config";
import { ethers } from "ethers";
import { ARC, ERC20_ABI } from "./config";
import { provisionAgentWallets } from "./wallets";
import { bridgeUsdcToArc } from "./cctp";
import { startRelay } from "./relay";
import { callRelayWithX402 } from "./agent";

async function main() {
  console.log("############################################################");
  console.log("#  BoA agentic settlement demo on Arc");
  console.log("#   [1] Circle Programmable Wallets for agents");
  console.log("#   [2] CCTP V2 bridge USDC -> Arc");
  console.log("#   [3] x402 pay-per-usage to the relay (REAL on-chain)");
  console.log("############################################################");

  // ---------- [1/3] wallets ----------
  console.log("\n========== [1/3] Provision agent wallets ==========");
  const wallets = await provisionAgentWallets(2);
  for (const w of wallets) console.log(`  ${w.id}: ${w.address}  [${w.custody}]`);
  const agent = wallets[0];
  const relayWallet = wallets[1];

  if (!agent.privateKey) {
    console.log("\nAgent wallet is real Circle PW (no local key). The live x402 leg needs a signer the");
    console.log("demo controls — run WITHOUT CIRCLE_API_KEY to use the funded simulated wallet on Arc,");
    console.log("or wire Circle PW's sign/transaction API in agent.ts. Stopping before the live leg.");
    return;
  }

  // ---------- [2/3] CCTP bridge ----------
  console.log("\n========== [2/3] CCTP V2: bridge USDC into Arc ==========");
  await bridgeUsdcToArc({
    amountUsdc: "5",
    recipient: agent.address,
    live: process.env.CCTP_LIVE === "1",
  });
  console.log("  note: agent's faucet USDC already on Arc stands in for the bridged funds for the live leg below.");

  // ---------- [3/3] x402 pay-per-usage (live) ----------
  console.log("\n========== [3/3] x402: agent pays relay per usage (live on Arc) ==========");
  const provider = new ethers.JsonRpcProvider(ARC.rpcUrl);
  const usdc = new ethers.Contract(ARC.usdc, ERC20_ABI, provider);
  const fmt = (v: bigint) => ethers.formatUnits(v, ARC.decimals);

  const relay = await startRelay(relayWallet.address);
  console.log(`  relay up at ${relay.url}, payTo=${relay.payTo}`);

  const agentBefore = await usdc.balanceOf(agent.address);
  const relayBefore = await usdc.balanceOf(relay.payTo);
  console.log(`\n  balances BEFORE:  agent=${fmt(agentBefore)}  relay=${fmt(relayBefore)} USDC`);

  const jobs = [
    { prompt: "summarize: hello world", maxTokens: 256 },
    { prompt: "translate to fr: good morning", maxTokens: 512 },
    { prompt: "write a haiku about USDC", maxTokens: 1024 },
  ];

  let totalPaid = 0n;
  for (const [i, job] of jobs.entries()) {
    const { result, txHash, paid } = await callRelayWithX402(relay.url, agent.privateKey, job);
    totalPaid += paid;
    console.log(`\n  call ${i + 1}: maxTokens=${job.maxTokens}  ->  paid ${fmt(paid)} USDC`);
    console.log(`    tx:     ${ARC.explorer}/tx/${txHash}`);
    console.log(`    result: ${JSON.stringify(result)}`);
  }

  const agentAfter = await usdc.balanceOf(agent.address);
  const relayAfter = await usdc.balanceOf(relay.payTo);
  console.log(`\n  balances AFTER:   agent=${fmt(agentAfter)}  relay=${fmt(relayAfter)} USDC`);
  console.log(`  agent delta = ${fmt(agentAfter - agentBefore)} USDC  (usage + gas, both in USDC)`);
  console.log(`  relay delta = +${fmt(relayAfter - relayBefore)} USDC  (= total usage billed ${fmt(totalPaid)})`);

  const ok = relayAfter - relayBefore === totalPaid && totalPaid > 0n;
  console.log(`\nRESULT: ${ok ? "PASS ✅ — relay paid per-usage via x402, settled on Arc" : "FAIL ❌ — relay credit != billed usage"}`);

  await relay.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error("\nERROR:", e?.shortMessage || e?.message || e); process.exit(1); });
