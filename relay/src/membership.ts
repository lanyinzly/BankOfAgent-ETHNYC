// Membership service — FOAMM voucher custody + the off-chain callable-quota ledger.
//
// Quota model (aligned with the web contract v0 — the redeem step must be "real"):
//   * Buying (wrap) mints ERC-7527 voucher(s) to the buyer AND credits the buyer
//     callable quota (quotaUsdcPerMembership per voucher).
//   * Holding a voucher is NOT enough to call — only bought/redeemed quota is.
//     So a recipient who was *transferred* an un-redeemed voucher has no quota and
//     gets 402 until they redeem it. That is what makes "redeem unlocks Agent B" real.
//   * Transferring moves the voucher (the claim) but NOT quota.
//   * Redeeming (unwrap) burns the voucher, returns the FOAMM premium on-chain, and
//     credits the redeemer quota ("redeem the voucher into quota").

import type { Agent, ChainAdapter } from "./types.ts";

interface VoucherRecord {
  tokenId: number;
  owner: string; // lowercased address
  ens?: string;
}

export interface BuyResult {
  tokenId: number;
  tokenIds: number[];
  pricePaid: number;
  priceBefore: number;
  priceAfter: number;
  quotaUsdc: number;
  txHashes: string[];
}
export interface RedeemResult {
  tokenId: number;
  refund: number;
  quotaCreditedUsdc: number;
  txHash?: string;
}
export interface ChargeResult {
  membership_token_id: number | null;
  charged: number;
}

export class MembershipService {
  private vouchers = new Map<number, VoucherRecord>();
  private quota = new Map<string, number>(); // address -> callable USDC quota
  private adapter: ChainAdapter;
  private quotaUsdcPerMembership: number;

  constructor(adapter: ChainAdapter, quotaUsdcPerMembership: number) {
    this.adapter = adapter;
    this.quotaUsdcPerMembership = quotaUsdcPerMembership;
  }

  private q(addr: string): number {
    return this.quota.get(addr.toLowerCase()) ?? 0;
  }
  // Credit callable quota (used by buy, redeem, and the startup bootstrap).
  creditStandalone(address: string, usdc: number): void {
    this.quota.set(address.toLowerCase(), round6(this.q(address) + usdc));
  }

  async buy(agent: Agent, quantity = 1): Promise<BuyResult> {
    const n = Math.max(1, Math.min(Math.floor(quantity) || 1, 50));
    const tokenIds: number[] = [];
    const txHashes: string[] = [];
    let priceBefore = 0;
    let priceAfter = 0;
    let pricePaid = 0;
    for (let i = 0; i < n; i++) {
      const r = await this.adapter.wrap(agent.address);
      this.vouchers.set(r.tokenId, { tokenId: r.tokenId, owner: agent.address.toLowerCase(), ens: agent.ens });
      tokenIds.push(r.tokenId);
      if (r.txHash) txHashes.push(r.txHash);
      if (i === 0) priceBefore = Number(r.priceBefore);
      priceAfter = Number(r.priceAfter);
      pricePaid += Number(r.pricePaid);
      this.creditStandalone(agent.address, this.quotaUsdcPerMembership);
    }
    return {
      tokenId: tokenIds[0],
      tokenIds,
      pricePaid: round6(pricePaid),
      priceBefore,
      priceAfter,
      quotaUsdc: round6(this.quotaUsdcPerMembership * n),
      txHashes,
    };
  }

  async redeem(agent: Agent, tokenId: number): Promise<RedeemResult> {
    const v = this.vouchers.get(tokenId);
    if (!v) throw new Error(`voucher ${tokenId} not found in ledger`);
    if (v.owner !== agent.address.toLowerCase()) {
      throw new Error(`voucher ${tokenId} not owned by ${agent.ens}`);
    }
    const res = await this.adapter.unwrap(agent.address, tokenId);
    this.vouchers.delete(tokenId);
    this.creditStandalone(agent.address, this.quotaUsdcPerMembership); // redeem -> quota
    return {
      tokenId,
      refund: Number(res.refund),
      quotaCreditedUsdc: round6(this.quotaUsdcPerMembership),
      txHash: res.txHash,
    };
  }

  async transfer(tokenId: number, from: Agent, to: Agent): Promise<{ txHash?: string }> {
    const v = this.vouchers.get(tokenId);
    if (!v) throw new Error(`voucher ${tokenId} not found in ledger`);
    if (v.owner !== from.address.toLowerCase()) {
      throw new Error(`voucher ${tokenId} not owned by ${from.ens}`);
    }
    const res = await this.adapter.transfer(from.address, to.address, tokenId);
    v.owner = to.address.toLowerCase();
    v.ens = to.ens;
    return res; // quota does NOT move with the voucher
  }

  vouchersOf(address: string): VoucherRecord[] {
    const a = address.toLowerCase();
    return [...this.vouchers.values()].filter((v) => v.owner === a).sort((x, y) => x.tokenId - y.tokenId);
  }

  availableQuota(address: string): number {
    return this.q(address);
  }

  hasAccess(address: string): boolean {
    return this.q(address) > 0;
  }

  // Deduct `amount` USDC from callable quota. Returns a voucher the agent owns
  // (for the receipt's membership_token_id), or null.
  charge(address: string, amount: number): ChargeResult {
    const before = this.q(address);
    const take = Math.min(before, amount);
    this.quota.set(address.toLowerCase(), round6(before - take));
    const owned = this.vouchersOf(address);
    return { membership_token_id: owned[0]?.tokenId ?? null, charged: round6(take) };
  }

  snapshot(address: string) {
    return {
      vouchers: this.vouchersOf(address).map((v) => v.tokenId),
      callableQuotaUsdc: this.q(address),
    };
  }
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
