// Shared types across the relay.

export interface Agent {
  ens: string;
  address: `0x${string}`;
  apiKey: string;
  // Only used by the onchain chain adapter (to sign wrap/unwrap/transfer txs).
  // Absent for a pure identity record; the memory adapter never needs it.
  privateKey?: `0x${string}`;
}

// Identity rail (STUB today: a static map; swap for ENS later).
export interface IdentityProvider {
  resolveByBearer(token: string): Agent | null; // token = api key OR ens name
  getByEns(ens: string): Agent | null;
  getByAddress(address: string): Agent | null;
  list(): Agent[];
}

// Settlement rail (STUB today: a mock USDC ledger; swap for Arc later).
export interface SettlementResult {
  settlement_tx: string;
  amount_usdc: number;
  balance_after: number;
}
export interface SettlementProvider {
  settle(agent: Agent, amountUsdc: number, memo: string): SettlementResult;
  balanceOf(agent: Agent): number;
}

// The canonical BoA usage receipt. Schema is FROZEN — the web demo and the
// proof rail (Hedera HCS later) must match this exactly.
export interface UsageReceipt {
  request_id: string;
  agent_ens: string;
  membership_token_id: number | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_cost_usdc: number;
  settlement_tx: string;
  price_before: string; // FOAMM membership premium snapshot before the call
  price_after: string; // FOAMM membership premium snapshot after the call
  timestamp: number; // ms epoch when metered
  router_signature: string; // ECDSA sig by the router key over the receipt body
}

// Proof rail (STUB today: signed receipts -> JSONL file + memory; swap for Hedera HCS).
export interface ProofSink {
  record(receipt: Omit<UsageReceipt, "router_signature">): Promise<UsageReceipt>;
  list(agentEns?: string): UsageReceipt[];
}

// ---- chain adapter (FOAMM membership market) ----

export interface MarketInfo {
  id: string;
  agency: string;
  app: string;
  currency: string;
  basePremium: bigint;
  mintFeePercent: bigint;
  burnFeePercent: bigint;
  maxSupply: number;
}

export interface PriceInfo {
  market: string;
  sold: number;
  // all premium values are decimal strings in ETH
  basePremium: string;
  currentPremium: string;
  nextPremium: string;
  // wei companions for exactness
  basePremiumWei: string;
  currentPremiumWei: string;
  nextPremiumWei: string;
  currency: string;
}

export interface WrapResult {
  tokenId: number;
  pricePaid: string; // ETH (premium + mintFee)
  priceBefore: string; // ETH premium at sold (this buy)
  priceAfter: string; // ETH premium at sold+1 (next buy)
  txHash?: string;
}

export interface UnwrapResult {
  tokenId: number;
  refund: string; // ETH returned (premium - burnFee), priced at post-burn supply
  txHash?: string;
}

// FOAMM membership market — implemented in-memory (default) or against the
// deployed ERC-7527 contracts on Base Sepolia (onchain).
export interface ChainAdapter {
  readonly mode: "memory" | "onchain";
  market(): MarketInfo;
  price(): Promise<PriceInfo>;
  wrap(toAddress: `0x${string}`): Promise<WrapResult>;
  unwrap(ownerAddress: `0x${string}`, tokenId: number): Promise<UnwrapResult>;
  transfer(from: `0x${string}`, to: `0x${string}`, tokenId: number): Promise<{ txHash?: string }>;
  ownerOf(tokenId: number): Promise<`0x${string}` | null>;
  totalSupply(): Promise<number>;
}
