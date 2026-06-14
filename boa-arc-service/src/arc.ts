// Arc testnet config + USDC helpers. Mirrors spikes/arc/src/agentic/config.ts
// (proven live on Arc testnet 2026-06-13). USDC is a 6-dp ERC-20; gas is paid in USDC.
import { ethers } from "ethers";

export const ARC = {
  key: "arc-testnet",
  rpcUrl: process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network",
  chainId: 5042002,
  usdc: "0x3600000000000000000000000000000000000000",
  decimals: 6,
  explorer: "https://testnet.arcscan.app",
} as const;

export const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

export const fmt = (v: bigint) => ethers.formatUnits(v, ARC.decimals);
export const txUrl = (h: string) => `${ARC.explorer}/tx/${h}`;
export const addrUrl = (a: string) => `${ARC.explorer}/address/${a}`;

export function provider() {
  return new ethers.JsonRpcProvider(ARC.rpcUrl);
}

export async function usdcBalance(addr: string): Promise<bigint> {
  const usdc = new ethers.Contract(ARC.usdc, ERC20_ABI, provider());
  return (await usdc.balanceOf(addr)) as bigint;
}

// Simple USDC transfer from a key -> to. Returns {txHash}. (Used by /api/settle.)
export async function usdcTransfer(fromKey: string, to: string, amount: bigint): Promise<string> {
  const wallet = new ethers.Wallet(fromKey, provider());
  const usdc = new ethers.Contract(ARC.usdc, ERC20_ABI, wallet);
  const tx = await usdc.transfer(to, amount);
  await tx.wait();
  return tx.hash as string;
}
