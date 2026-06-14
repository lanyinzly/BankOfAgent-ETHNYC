// Pre-stage check: run this right before you demo. Confirms both RPCs are up, shows
// wallet balances + explorer links, and tells you whether `npm run arc` / `npm run
// agentic` are ready to go. Exits non-zero if not ready (so `npm run demo` won't start).
import "dotenv/config";
import { ethers } from "ethers";
import { NETWORKS } from "./config";

const balAbi = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

async function checkRpc(key: "arc" | "base") {
  const net = NETWORKS[key];
  const provider = new ethers.JsonRpcProvider(net.rpcUrl);
  try {
    const chainId = Number((await provider.getNetwork()).chainId);
    const ok = chainId === net.chainId;
    console.log(`  ${net.label.padEnd(14)} ${ok ? "UP ✓" : "?? "}  chainId=${chainId}${ok ? "" : ` (expected ${net.chainId})`}`);
    return { net, provider, ok };
  } catch (e: any) {
    console.log(`  ${net.label.padEnd(14)} DOWN ✗  (${e?.shortMessage || e?.message || e})`);
    return { net, provider, ok: false };
  }
}

async function main() {
  console.log("=== BoA · Arc demo preflight ===\n");
  const addrA = process.env.WALLET_A_ADDRESS;
  const addrB = process.env.WALLET_B_ADDRESS;
  if (!addrA || !addrB) {
    console.error("Missing WALLET_A_ADDRESS / WALLET_B_ADDRESS in .env — run `npm run gen` first.");
    process.exit(1);
  }

  console.log("RPC reachability:");
  const arc = await checkRpc("arc");
  await checkRpc("base");

  const usdc = new ethers.Contract(NETWORKS.arc.usdc, balAbi, arc.provider);
  const dec = Number(await usdc.decimals());
  const fmt = (v: bigint) => ethers.formatUnits(v, dec);
  const balA: bigint = await usdc.balanceOf(addrA);
  const balB: bigint = await usdc.balanceOf(addrB);

  console.log(`\nWallets (Arc USDC):`);
  console.log(`  A (sender/agent):     ${addrA}  =  ${fmt(balA)} USDC`);
  console.log(`     ${NETWORKS.arc.explorer}/address/${addrA}`);
  console.log(`  B (recipient/relay):  ${addrB}  =  ${fmt(balB)} USDC`);
  console.log(`     ${NETWORKS.arc.explorer}/address/${addrB}`);

  const needArc = ethers.parseUnits("1", dec);
  const needAgentic = ethers.parseUnits("0.05", dec);
  const arcReady = arc.ok && balA >= needArc;
  console.log(`\nReady checks:`);
  console.log(`  npm run arc      (A needs >= 1 USDC):     ${balA >= needArc ? "READY ✓" : "FUND A → https://faucet.circle.com (Arc Testnet)"}`);
  console.log(`  npm run agentic  (A needs >~ 0.05 USDC):  ${balA >= needAgentic ? "READY ✓" : "FUND A → faucet.circle.com"}`);

  console.log(`\n${arcReady ? "PREFLIGHT: READY ✅ — go demo." : "PREFLIGHT: NOT READY — fund wallet A, then re-run."}`);
  process.exit(arcReady ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
