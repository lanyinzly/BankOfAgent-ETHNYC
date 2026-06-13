// In-memory FOAMM market — the DEFAULT chain adapter.
//
// Faithfully replicates the ERC7527Agency curve so the demo runs with no chain,
// no RPC, no funded keys (honouring "the spine must run with every external rail
// stubbed"). The math is byte-for-byte the same as the Solidity:
//
//   premium = basePremium + sold * basePremium / 100      (integer division, wei)
//   mintFee = premium * mintFeePercent / 10000
//   burnFee = premium * burnFeePercent / 10000
//   unwrap is priced at the POST-burn supply (matches ERC7527Agency.unwrap)
//
// tokenIds are assigned sequentially and never reused (monotonic), mirroring a
// caller that always picks a fresh id.

import { formatEther } from "viem";
import type { ChainAdapter, MarketInfo, PriceInfo, WrapResult, UnwrapResult } from "../types.ts";
import type { MarketConfig } from "../config.ts";

export class InMemoryFoamm implements ChainAdapter {
  readonly mode = "memory" as const;
  private owners = new Map<number, `0x${string}`>();
  private minted = 0; // monotonic id counter
  private cfg: MarketConfig;

  constructor(cfg: MarketConfig) {
    this.cfg = cfg;
  }

  private premiumWei(sold: number): bigint {
    const base = this.cfg.basePremium;
    return base + (BigInt(sold) * base) / 100n;
  }
  private mintFeeWei(premium: bigint): bigint {
    return (premium * this.cfg.mintFeePercent) / 10000n;
  }
  private burnFeeWei(premium: bigint): bigint {
    return (premium * this.cfg.burnFeePercent) / 10000n;
  }

  market(): MarketInfo {
    return {
      id: this.cfg.id,
      agency: this.cfg.agency,
      app: this.cfg.app,
      currency: this.cfg.currency,
      basePremium: this.cfg.basePremium,
      mintFeePercent: this.cfg.mintFeePercent,
      burnFeePercent: this.cfg.burnFeePercent,
      maxSupply: this.cfg.maxSupply,
    };
  }

  async price(): Promise<PriceInfo> {
    const sold = this.owners.size;
    const cur = this.premiumWei(sold);
    const next = this.premiumWei(sold + 1);
    return {
      market: this.cfg.id,
      sold,
      basePremium: formatEther(this.cfg.basePremium),
      currentPremium: formatEther(cur),
      nextPremium: formatEther(next),
      basePremiumWei: this.cfg.basePremium.toString(),
      currentPremiumWei: cur.toString(),
      nextPremiumWei: next.toString(),
      currency: this.cfg.currency,
    };
  }

  async wrap(toAddress: `0x${string}`): Promise<WrapResult> {
    const soldBefore = this.owners.size;
    if (soldBefore >= this.cfg.maxSupply) throw new Error("market max supply reached");
    const premiumBefore = this.premiumWei(soldBefore);
    const pricePaid = premiumBefore + this.mintFeeWei(premiumBefore);

    const tokenId = ++this.minted;
    this.owners.set(tokenId, toAddress);

    const premiumAfter = this.premiumWei(this.owners.size);
    return {
      tokenId,
      pricePaid: formatEther(pricePaid),
      priceBefore: formatEther(premiumBefore),
      priceAfter: formatEther(premiumAfter),
    };
  }

  async unwrap(ownerAddress: `0x${string}`, tokenId: number): Promise<UnwrapResult> {
    const owner = this.owners.get(tokenId);
    if (!owner) throw new Error(`token ${tokenId} does not exist`);
    if (owner.toLowerCase() !== ownerAddress.toLowerCase()) {
      throw new Error(`token ${tokenId} not owned by ${ownerAddress}`);
    }
    this.owners.delete(tokenId);
    // priced at post-burn supply, exactly like ERC7527Agency.unwrap
    const postSold = this.owners.size;
    const premium = this.premiumWei(postSold);
    const refund = premium - this.burnFeeWei(premium);
    return { tokenId, refund: formatEther(refund) };
  }

  async transfer(from: `0x${string}`, to: `0x${string}`, tokenId: number): Promise<void> {
    const owner = this.owners.get(tokenId);
    if (!owner) throw new Error(`token ${tokenId} does not exist`);
    if (owner.toLowerCase() !== from.toLowerCase()) {
      throw new Error(`token ${tokenId} not owned by ${from}`);
    }
    this.owners.set(tokenId, to);
  }

  async ownerOf(tokenId: number): Promise<`0x${string}` | null> {
    return this.owners.get(tokenId) ?? null;
  }

  async totalSupply(): Promise<number> {
    return this.owners.size;
  }
}
