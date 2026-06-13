// Membership service — ties the FOAMM chain adapter together with the relay's
// off-chain quota ledger.
//
// Quota model (documented in README — the web demo must align):
//   * Buying (wrap) mints an ERC-7527 voucher to the agent AND attaches a metered
//     usage allowance (quotaUsdcPerMembership) to that token.
//   * An agent may call models while it has available quota:
//         availableQuota(agent) = Σ allowance(vouchers it owns) + standaloneQuota(agent)
//   * Transferring the voucher moves its REMAINING allowance with it.
//   * Redeeming (unwrap) burns the voucher, returns the FOAMM premium on-chain,
//     and converts the voucher's remaining allowance into STANDALONE quota for the
//     redeemer ("redeem the voucher into quota") — so a second agent can keep
//     calling after redeeming, which is exactly the demo's closing step.

import type { Agent, ChainAdapter, WrapResult } from "./types.ts";

interface VoucherRecord {
  tokenId: number;
  owner: string; // lowercased address
  ens?: string;
  allowanceUsdc: number;
}

export interface BuyResult extends WrapResult {
  quotaUsdc: number;
}
export interface RedeemResult {
  tokenId: number;
  refund: string;
  quotaCreditedUsdc: number;
  txHash?: string;
}
export interface ChargeResult {
  membership_token_id: number | null;
  charged: number;
}

export class MembershipService {
  private vouchers = new Map<number, VoucherRecord>();
  private standalone = new Map<string, number>(); // address -> usdc quota
  private adapter: ChainAdapter;
  private quotaUsdcPerMembership: number;

  constructor(adapter: ChainAdapter, quotaUsdcPerMembership: number) {
    this.adapter = adapter;
    this.quotaUsdcPerMembership = quotaUsdcPerMembership;
  }

  private std(addr: string): number {
    return this.standalone.get(addr.toLowerCase()) ?? 0;
  }

  async buy(agent: Agent): Promise<BuyResult> {
    const res = await this.adapter.wrap(agent.address);
    this.vouchers.set(res.tokenId, {
      tokenId: res.tokenId,
      owner: agent.address.toLowerCase(),
      ens: agent.ens,
      allowanceUsdc: this.quotaUsdcPerMembership,
    });
    return { ...res, quotaUsdc: this.quotaUsdcPerMembership };
  }

  async redeem(agent: Agent, tokenId: number): Promise<RedeemResult> {
    const v = this.vouchers.get(tokenId);
    if (!v) throw new Error(`voucher ${tokenId} not found in ledger`);
    if (v.owner !== agent.address.toLowerCase()) {
      throw new Error(`voucher ${tokenId} not owned by ${agent.ens}`);
    }
    const res = await this.adapter.unwrap(agent.address, tokenId);
    // convert remaining allowance into standalone quota for the redeemer
    const key = agent.address.toLowerCase();
    this.standalone.set(key, round6(this.std(key) + v.allowanceUsdc));
    this.vouchers.delete(tokenId);
    return {
      tokenId,
      refund: res.refund,
      quotaCreditedUsdc: round6(v.allowanceUsdc),
      txHash: res.txHash,
    };
  }

  async transfer(tokenId: number, from: Agent, to: Agent): Promise<void> {
    const v = this.vouchers.get(tokenId);
    if (!v) throw new Error(`voucher ${tokenId} not found in ledger`);
    if (v.owner !== from.address.toLowerCase()) {
      throw new Error(`voucher ${tokenId} not owned by ${from.ens}`);
    }
    await this.adapter.transfer(from.address, to.address, tokenId);
    v.owner = to.address.toLowerCase();
    v.ens = to.ens;
  }

  vouchersOf(address: string): VoucherRecord[] {
    const a = address.toLowerCase();
    return [...this.vouchers.values()].filter((v) => v.owner === a).sort((x, y) => x.tokenId - y.tokenId);
  }

  availableQuota(address: string): number {
    const fromVouchers = this.vouchersOf(address).reduce((s, v) => s + v.allowanceUsdc, 0);
    return round6(fromVouchers + this.std(address));
  }

  hasAccess(address: string): boolean {
    return this.availableQuota(address) > 0;
  }

  // Deduct `amount` USDC: voucher allowances first (lowest tokenId), then standalone.
  // Returns the voucher charged against (for the receipt), or null if standalone.
  charge(address: string, amount: number): ChargeResult {
    let remaining = amount;
    let membership_token_id: number | null = null;
    for (const v of this.vouchersOf(address)) {
      if (remaining <= 0) break;
      if (v.allowanceUsdc <= 0) continue;
      if (membership_token_id === null) membership_token_id = v.tokenId;
      const take = Math.min(v.allowanceUsdc, remaining);
      v.allowanceUsdc = round6(v.allowanceUsdc - take);
      remaining = round6(remaining - take);
    }
    if (remaining > 0) {
      const key = address.toLowerCase();
      const take = Math.min(this.std(key), remaining);
      this.standalone.set(key, round6(this.std(key) - take));
      remaining = round6(remaining - take);
    }
    return { membership_token_id, charged: round6(amount - Math.max(0, remaining)) };
  }

  snapshot(address: string) {
    return {
      vouchers: this.vouchersOf(address).map((v) => ({ tokenId: v.tokenId, allowanceUsdc: v.allowanceUsdc })),
      standaloneQuotaUsdc: this.std(address),
      availableQuotaUsdc: this.availableQuota(address),
    };
  }
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
