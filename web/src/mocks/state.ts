// ─────────────────────────────────────────────────────────────────────────────
// In-memory state for the mock relay. This stands in for the relay's database,
// the ERC-7527 agency/app contracts, and the metering ledger. It is intentionally
// simple — just enough to make the full economic loop real, not faked.
// ─────────────────────────────────────────────────────────────────────────────

import { BASE_PREMIUM, MAX_SUPPLY } from '../lib/foamm';
import { MARKET_ID } from '../config';
import type { UsageReceipt } from '../types';

export type VoucherStatus = 'active' | 'transferred' | 'redeemed';

export interface Voucher {
  tokenId: number;
  owner: string; // agent ENS
  market: string;
  pricePaid: number;
  status: VoucherStatus;
  mintedAt: number;
}

/** The single forward-compute market this demo trades. */
export const market = {
  id: MARKET_ID,
  basePremium: BASE_PREMIUM,
  sold: 0,
  maxSupply: MAX_SUPPLY,
};

export const vouchers: Voucher[] = [];
export const ledger: UsageReceipt[] = [];

/** Spot unit price for live metering — USDC per 1k tokens. Drifts up with use. */
export const spot = { pricePer1k: 0.5 };

let nextTokenId = 1001;

export function mintVoucher(owner: string, pricePaid: number): Voucher {
  const v: Voucher = {
    tokenId: nextTokenId++,
    owner,
    market: market.id,
    pricePaid,
    status: 'active',
    mintedAt: Date.now(),
  };
  vouchers.push(v);
  return v;
}

export function findVoucher(tokenId: number): Voucher | undefined {
  return vouchers.find((v) => v.tokenId === tokenId);
}

/**
 * An agent can call models when it controls usable quota: it owns a voucher that
 * is still active (it minted and kept it) or that it has redeemed into quota.
 * A voucher that has been transferred away — or received but not yet redeemed —
 * does NOT grant access. That gate is what makes "redeem" a real step.
 */
export function hasAccess(agent: string): boolean {
  return vouchers.some(
    (v) => v.owner === agent && (v.status === 'active' || v.status === 'redeemed'),
  );
}

/** Deterministic, ENS-derived 0x address (FNV-1a hash → 40 hex chars). */
export function deriveAddress(ens: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < ens.length; i++) {
    h ^= ens.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let hex = '';
  let seed = h >>> 0;
  while (hex.length < 40) {
    seed = (Math.imul(seed, 0x01000193) ^ (seed >>> 13)) >>> 0;
    hex += seed.toString(16).padStart(8, '0');
  }
  return `0x${hex.slice(0, 40)}`;
}
