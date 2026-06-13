// Central config for the BoA relay. Everything is overridable via env, but the
// defaults are chosen so that `node relay` + `npm run demo` works end-to-end with
// ZERO external dependencies (no chain, no ENS, no Arc, no Hedera) — the spine
// must run even when every external rail is stubbed.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// relay/src -> repo/contracts/deployments.json
const DEPLOYMENTS_PATH = resolve(__dirname, "../../contracts/deployments.json");

export type ChainMode = "memory" | "onchain";

export interface MarketConfig {
  id: string;
  // ERC-7527 clones (only used in onchain mode)
  agency: string;
  app: string;
  currency: string; // 0x0 == native ETH
  // FOAMM curve params (used by the in-memory adapter and for display)
  basePremium: bigint; // wei
  mintFeePercent: bigint; // out of 10000
  burnFeePercent: bigint; // out of 10000
  maxSupply: number;
  chainId?: number;
}

export interface Config {
  port: number;
  chainMode: ChainMode;
  rpcUrl: string;
  routerPrivateKey: `0x${string}`;
  market: MarketConfig;
  // economics
  quotaUsdcPerMembership: number; // metered-usage budget attached to each voucher
  priceInputPer1k: number; // USDC per 1k input tokens
  priceOutputPer1k: number; // USDC per 1k output tokens
  // upstream model (optional). If unset -> stub echo model.
  upstreamBaseUrl: string | null;
  upstreamApiKey: string | null;
  // proof sink file
  receiptsFile: string;
  deploymentsPath: string;
}

function loadDeployments(): any | null {
  const p = process.env.BOA_DEPLOYMENTS_PATH || DEPLOYMENTS_PATH;
  try {
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    console.warn(`[config] could not read deployments.json at ${p}: ${(e as Error).message}`);
  }
  return null;
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function numEnv(name: string, dflt: number): number {
  const v = env(name);
  if (v === undefined) return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

// Sensible public default RPC per testnet, so onchain mode works against whatever
// chain deployments.json points at without extra env. Override with RPC_URL.
function defaultRpcForChain(chainId?: number): string {
  switch (chainId) {
    case 84532:
      return "https://sepolia.base.org"; // Base Sepolia
    case 11155111:
      return "https://ethereum-sepolia-rpc.publicnode.com"; // Ethereum Sepolia
    default:
      return "https://sepolia.base.org";
  }
}

export function loadConfig(): Config {
  const deployments = loadDeployments();
  const dm = deployments?.market ?? {};

  // Default FOAMM params mirror contracts/script/DeployBoA.s.sol so memory mode
  // behaves identically to the deployed market even with no deployments.json.
  const market: MarketConfig = {
    id: env("BOA_MARKET_ID") ?? dm.id ?? "boa-membership",
    agency: env("BOA_AGENCY") ?? dm.agency ?? "0x0000000000000000000000000000000000000000",
    app: env("BOA_APP") ?? dm.app ?? "0x0000000000000000000000000000000000000000",
    currency: dm.currency ?? "0x0000000000000000000000000000000000000000",
    basePremium: BigInt(env("BOA_BASE_PREMIUM") ?? dm.basePremium ?? "20000000000000"), // 0.00002 ETH
    mintFeePercent: BigInt(env("BOA_MINT_FEE_PERCENT") ?? dm.mintFeePercent ?? "100"),
    burnFeePercent: BigInt(env("BOA_BURN_FEE_PERCENT") ?? dm.burnFeePercent ?? "100"),
    maxSupply: numEnv("BOA_MAX_SUPPLY", 100),
    chainId: deployments?.chainId,
  };

  // Default router key is a well-known public anvil test key — fine for signing
  // demo receipts. Override with ROUTER_PRIVATE_KEY in any real setting.
  const routerPrivateKey = (env("ROUTER_PRIVATE_KEY") ??
    "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6") as `0x${string}`;

  const chainMode = (env("CHAIN_MODE") as ChainMode) ?? "memory";

  return {
    port: numEnv("PORT", 8787),
    chainMode: chainMode === "onchain" ? "onchain" : "memory",
    rpcUrl:
      env("RPC_URL") ?? env("BASE_SEPOLIA_RPC_URL") ?? defaultRpcForChain(deployments?.chainId),
    routerPrivateKey,
    market,
    quotaUsdcPerMembership: numEnv("BOA_QUOTA_USDC", 5),
    priceInputPer1k: numEnv("BOA_PRICE_INPUT_PER_1K", 0.0005),
    priceOutputPer1k: numEnv("BOA_PRICE_OUTPUT_PER_1K", 0.0015),
    upstreamBaseUrl: env("UPSTREAM_BASE_URL") ?? null,
    upstreamApiKey: env("UPSTREAM_API_KEY") ?? null,
    receiptsFile: env("BOA_RECEIPTS_FILE") ?? resolve(__dirname, "../.data/receipts.jsonl"),
    deploymentsPath: process.env.BOA_DEPLOYMENTS_PATH || DEPLOYMENTS_PATH,
  };
}
