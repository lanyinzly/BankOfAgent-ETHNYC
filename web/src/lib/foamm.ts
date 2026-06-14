// ─────────────────────────────────────────────────────────────────────────────
// FOAMM — Function Oracle Automated Market Maker.
//
// This mirrors the ERC-7527 reference implementation (EIP7527/src/ERC7527.sol)
// exactly. The on-chain oracle prices each voucher off the number already sold:
//
//     premium = basePremium + sold * basePremium / 100
//
// i.e. every unit of forward capacity claimed lifts the premium by 1% of base.
// That straight line IS the forward curve: the premium on future capacity is the
// market's live forecast of its scarcity. Buying moves you up and to the right.
// ─────────────────────────────────────────────────────────────────────────────

/** Asset.basePremium for this demo market (USDC). */
export const BASE_PREMIUM = 10;
/** Forward capacity offered on the curve (the app's ERC721 max supply). */
export const MAX_SUPPLY = 30;
/** mintFeePercent — basis points charged on wrap (matches Asset.mintFeePercent). */
export const MINT_FEE_BPS = 50; // 0.50%
/** burnFeePercent — basis points charged on unwrap (matches Asset.burnFeePercent). */
export const BURN_FEE_BPS = 50; // 0.50%

/** FOAMM premium at a given amount sold. Exactly the contract's getWrapOracle. */
export function premiumAt(sold: number, basePremium = BASE_PREMIUM): number {
  return basePremium + (sold * basePremium) / 100;
}

/** Mint fee on a wrap, in USDC (premium * mintFeePercent / 10000). */
export function mintFee(premium: number): number {
  return (premium * MINT_FEE_BPS) / 10000;
}

/** The full forward curve as discrete points, for plotting. */
export function forwardCurve(
  basePremium = BASE_PREMIUM,
  maxSupply = MAX_SUPPLY,
): Array<{ sold: number; premium: number }> {
  return Array.from({ length: maxSupply + 1 }, (_, sold) => ({
    sold,
    premium: premiumAt(sold, basePremium),
  }));
}

/** Format a USDC amount for display. */
export function usd(n: number, dp = 2): string {
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })}`;
}
