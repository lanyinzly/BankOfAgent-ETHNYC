// ─────────────────────────────────────────────────────────────────────────────
// In-memory mock relay — the BoA interface contract v0 as plain async functions.
//
// This replaces the MSW/service-worker mock: relayClient calls these directly in
// mock mode, so the full economic loop (identity → buy → call → transfer → redeem
// → call) runs with NO network and NO service worker. Nothing to register, nothing
// to go stale across deploys — the demo just works, anywhere.
// ─────────────────────────────────────────────────────────────────────────────

import { mintFee, premiumAt } from '../lib/foamm';
import { RelayError } from '../lib/relayError';
import { estimateTokens, generateCompletion } from './hermes';
import { deriveAddress, findVoucher, hasAccess, ledger, market, mintVoucher, spot } from './state';
import type {
  BuyResult,
  ChatResult,
  Identity,
  PriceQuote,
  RedeemResult,
  TransferResult,
  UsageReceipt,
} from '../types';

const round = (n: number, dp = 2): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

// A little artificial latency so the UI shows real loading states during the demo.
const latency = () => new Promise<void>((r) => setTimeout(r, 220 + Math.random() * 260));

function priceQuote(): PriceQuote {
  return {
    market: market.id,
    basePremium: market.basePremium,
    sold: market.sold,
    maxSupply: market.maxSupply,
    currentPremium: premiumAt(market.sold),
    nextPremium: premiumAt(market.sold + 1),
  };
}

export const mockRelay = {
  async identity(agent: string): Promise<Identity> {
    await latency();
    if (!agent) throw new RelayError(400, 'missing agent');
    return { address: deriveAddress(agent), ens: agent };
  },

  async price(_market: string): Promise<PriceQuote> {
    await latency();
    return priceQuote();
  },

  async buy(body: { agent: string; market: string; quantity?: number }): Promise<BuyResult> {
    await latency();
    const agent = body.agent ?? '';
    const quantity = Math.max(1, Math.min(10, Math.floor(body.quantity ?? 1)));
    if (!agent) throw new RelayError(400, 'missing agent');
    if (market.sold + quantity > market.maxSupply) {
      throw new RelayError(409, 'max supply reached for this market');
    }

    const priceBefore = premiumAt(market.sold);
    const tokenIds: number[] = [];
    let pricePaid = 0;

    // Wrap one ERC-7527 voucher per unit; each wrap moves `sold` up the curve.
    for (let i = 0; i < quantity; i++) {
      const premium = premiumAt(market.sold);
      const unitCost = premium + mintFee(premium);
      pricePaid += unitCost;
      tokenIds.push(mintVoucher(agent, unitCost).tokenId);
      market.sold += 1;
    }
    const priceAfter = premiumAt(market.sold);

    return {
      tokenId: tokenIds[0],
      tokenIds,
      pricePaid: round(pricePaid),
      priceBefore: round(priceBefore),
      priceAfter: round(priceAfter),
    };
  },

  async transfer(body: { tokenId: number; from: string; to: string }): Promise<TransferResult> {
    await latency();
    const v = findVoucher(body.tokenId);
    if (!v) throw new RelayError(404, 'voucher not found');
    if (body.from && v.owner !== body.from) {
      throw new RelayError(403, 'sender does not own this voucher');
    }
    v.owner = body.to ?? v.owner;
    v.status = 'transferred'; // held by recipient but not yet usable until redeemed
    return { tokenId: v.tokenId, from: body.from ?? '', to: v.owner };
  },

  async redeem(body: { tokenId: number; agent: string }): Promise<RedeemResult> {
    await latency();
    const v = findVoucher(body.tokenId);
    if (!v) throw new RelayError(404, 'voucher not found');
    if (body.agent && v.owner !== body.agent) {
      throw new RelayError(403, 'only the holder can redeem');
    }
    v.status = 'redeemed'; // claim exercised → quota credited to the holder
    return { tokenId: v.tokenId };
  },

  async usage(agent: string): Promise<UsageReceipt[]> {
    await latency();
    return agent ? ledger.filter((r) => r.agent === agent) : [...ledger];
  },

  async chat(agent: string, prompt: string): Promise<ChatResult> {
    await latency();
    if (!agent) throw new RelayError(401, 'missing Authorization: Bearer <agent>');
    // Quota gate: an agent must hold usable quota (active or redeemed voucher).
    if (!hasAccess(agent)) {
      throw new RelayError(
        402,
        `${agent} has no usable quota. Buy a membership, or redeem a voucher transferred to you.`,
      );
    }

    const content = generateCompletion(prompt, agent);
    const prompt_tokens = estimateTokens(prompt);
    const completion_tokens = estimateTokens(content);
    const total_tokens = prompt_tokens + completion_tokens;

    // Spot metering: cost charged at the pre-call spot, which drifts up with use.
    const price_before = round(spot.pricePer1k, 4);
    const cost = round((total_tokens / 1000) * price_before, 4);
    spot.pricePer1k = round(spot.pricePer1k * 1.012, 6);
    const price_after = round(spot.pricePer1k, 4);

    const id = `chatcmpl-${Math.random().toString(36).slice(2, 10)}`;
    const receipt: UsageReceipt = {
      id,
      agent,
      model: 'boa-router/auto',
      prompt_tokens,
      completion_tokens,
      total_tokens,
      cost,
      price_before,
      price_after,
      currency: 'USDC',
      timestamp: Date.now(),
    };
    ledger.unshift(receipt);

    return { id, model: receipt.model, content, usage: receipt };
  },
};
