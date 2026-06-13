// BoA settlement-rail spike: move 1 USDC from wallet A -> wallet B and prove it on-chain.
//
//   npm run arc    # primary rail  (Arc testnet)
//   npm run base   # fallback rail (Base Sepolia, standard USDC ERC-20 transfer)
//
// Prints: network info, balances BEFORE, the tx hash, balances AFTER, and a PASS/FAIL verdict.
import "dotenv/config";
import { ethers } from "ethers";
import { NETWORKS, ERC20_ABI, type NetworkKey } from "./config";

const AMOUNT_USDC = "1"; // transfer exactly 1 USDC

async function main() {
  const key = (process.argv[2] || process.env.NETWORK || "arc") as NetworkKey;
  const net = NETWORKS[key];
  if (!net) {
    console.error(`Unknown network "${key}". Use "arc" or "base".`);
    process.exit(1);
  }

  const pkA = process.env.PRIVATE_KEY_A;
  const addrB = process.env.WALLET_B_ADDRESS;
  if (!pkA || !addrB) {
    console.error("Missing PRIVATE_KEY_A and/or WALLET_B_ADDRESS in .env.");
    console.error("Run `npm run gen` to create wallets, then fund wallet A at the faucet.");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(net.rpcUrl);
  const walletA = new ethers.Wallet(pkA, provider);
  const addrA = walletA.address;
  const usdc = new ethers.Contract(net.usdc, ERC20_ABI, walletA);

  // --- network + token sanity ---
  const liveChainId = Number((await provider.getNetwork()).chainId);
  const decimals = Number(await usdc.decimals());
  const symbol: string = await usdc.symbol();
  const amount = ethers.parseUnits(AMOUNT_USDC, decimals);
  const fmt = (v: bigint) => ethers.formatUnits(v, decimals);

  console.log(`\n================ ${net.label} ================`);
  console.log(`RPC:       ${net.rpcUrl}`);
  console.log(`chainId:   ${liveChainId} (expected ${net.chainId})${liveChainId === net.chainId ? " ✓" : " ✗ MISMATCH"}`);
  console.log(`USDC:      ${net.usdc}  (${symbol}, ${decimals} decimals)`);
  console.log(`explorer:  ${net.explorer}`);
  console.log(`gas token: ${net.gasSymbol}`);
  console.log(`\nWallet A (sender):    ${addrA}`);
  console.log(`Wallet B (recipient): ${addrB}`);

  // --- balances BEFORE ---
  const balA0: bigint = await usdc.balanceOf(addrA);
  const balB0: bigint = await usdc.balanceOf(addrB);
  const gasA: bigint = await provider.getBalance(addrA); // native (18 decimals)
  console.log(`\n----- balances BEFORE -----`);
  console.log(`A: ${fmt(balA0)} ${symbol}`);
  console.log(`B: ${fmt(balB0)} ${symbol}`);
  console.log(`A gas balance: ${ethers.formatEther(gasA)} ${net.gasSymbol}`);

  // --- preconditions ---
  if (balA0 < amount) {
    console.error(`\n[BLOCKED] Wallet A holds ${fmt(balA0)} ${symbol}, needs >= ${AMOUNT_USDC}.`);
    console.error(`Fund it, then re-run:`);
    console.error(`  faucet:  ${net.faucet}`);
    console.error(`  address: ${addrA}`);
    process.exit(2);
  }
  // On Arc gas IS USDC, so a USDC balance already covers gas. On Base we need ETH.
  if (net.gasSymbol !== symbol && gasA === 0n) {
    console.error(`\n[BLOCKED] Wallet A has 0 ${net.gasSymbol} for gas.`);
    console.error(`  gas faucet: ${net.gasFaucet}`);
    console.error(`  address:    ${addrA}`);
    process.exit(2);
  }

  // --- send 1 USDC ---
  console.log(`\nSending ${AMOUNT_USDC} ${symbol}: A -> B ...`);
  const tx = await usdc.transfer(addrB, amount);
  console.log(`tx hash:  ${tx.hash}`);
  console.log(`tx link:  ${net.explorer}/tx/${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`mined:    block ${receipt?.blockNumber}, status=${receipt?.status === 1 ? "success ✓" : "FAILED ✗"}`);

  // --- balances AFTER ---
  const balA1: bigint = await usdc.balanceOf(addrA);
  const balB1: bigint = await usdc.balanceOf(addrB);
  console.log(`\n----- balances AFTER -----`);
  console.log(`A: ${fmt(balA1)} ${symbol}  (delta ${fmt(balA1 - balA0)})`);
  console.log(`B: ${fmt(balB1)} ${symbol}  (delta +${fmt(balB1 - balB0)})`);

  const moved = balB1 - balB0 === amount && balA0 - balA1 >= amount;
  console.log(`\nRESULT: ${moved ? "PASS ✅ — 1 USDC moved A -> B (A decreased, B increased)" : "FAIL ❌ — unexpected balance deltas"}`);
  process.exit(moved ? 0 : 1);
}

main().catch((err) => {
  console.error("\nERROR:", err?.shortMessage || err?.message || err);
  process.exit(1);
});
