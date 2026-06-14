// Shapes returned by the relay interface contract v0. The mock and the live
// relay both speak exactly this contract.

export interface Identity {
  address: string;
  ens: string;
}

export interface PriceQuote {
  market: string;
  /** The Asset.basePremium of the ERC-7527 agency (USDC). */
  basePremium: number;
  /** Units of forward capacity already claimed (ERC721 totalSupply). */
  sold: number;
  /** Total forward capacity offered on this curve. */
  maxSupply: number;
  /** FOAMM premium at the current `sold` (USDC). */
  currentPremium: number;
  /** FOAMM premium for the very next unit (USDC) — the marginal forward price. */
  nextPremium: number;
}

export interface BuyResult {
  /** First minted voucher id (contract mints one ERC-7527 token per unit). */
  tokenId: number;
  /** Every voucher id minted in this purchase. */
  tokenIds?: number[];
  /** Total premium + mint fee paid (USDC). */
  pricePaid: number;
  /** FOAMM premium before this purchase (USDC). */
  priceBefore: number;
  /** FOAMM premium after this purchase (USDC) — the curve has moved up. */
  priceAfter: number;
}

export interface TransferResult {
  tokenId: number;
  from: string;
  to: string;
}

export interface RedeemResult {
  tokenId: number;
}

/** The metering receipt — also delivered on the `x-boa-usage` response header. */
export interface UsageReceipt {
  id: string;
  agent: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** Cost of this call drawn from the agent's quota (USDC). */
  cost: number;
  /** Spot unit price before the call (USDC / 1k tokens). */
  price_before: number;
  /** Spot unit price after the call (USDC / 1k tokens). */
  price_after: number;
  currency: string;
  timestamp: number;
}

export interface ChatResult {
  id: string;
  model: string;
  content: string;
  usage: UsageReceipt;
}
