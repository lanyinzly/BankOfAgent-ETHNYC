// ─────────────────────────────────────────────────────────────────────────────
// Mock relay — MSW handlers implementing relay interface contract v0.
//
// These intercept the exact same requests the live relay would serve, at the
// same paths, with the same response shapes. Swap NEXT_PUBLIC_RELAY_URL to a real
// relay and these handlers simply stop being registered.
// ─────────────────────────────────────────────────────────────────────────────

import { http, HttpResponse } from 'msw';
import { RELAY_URL } from '../config';
import { mintFee, premiumAt } from '../lib/foamm';
import { estimateTokens, generateCompletion } from './hermes';
import {
  deriveAddress,
  findVoucher,
  hasAccess,
  ledger,
  market,
  mintVoucher,
  spot,
  vouchers,
} from './state';
import type { UsageReceipt } from '../types';

const B = RELAY_URL; // base path the mock serves on ("/relay")

// Small artificial latency so the UI shows real loading states during the demo.
const latency = () => new Promise((r) => setTimeout(r, 220 + Math.random() * 260));

function priceQuote() {
  return {
    market: market.id,
    basePremium: market.basePremium,
    sold: market.sold,
    maxSupply: market.maxSupply,
    currentPremium: premiumAt(market.sold),
    nextPremium: premiumAt(market.sold + 1),
  };
}

export const handlers = [
  // ── GET /boa/identity?agent=<ens> ──────────────────────────────────────────
  http.get(`${B}/boa/identity`, async ({ request }) => {
    await latency();
    const agent = new URL(request.url).searchParams.get('agent') ?? '';
    if (!agent) return HttpResponse.json({ error: 'missing agent' }, { status: 400 });
    return HttpResponse.json({ address: deriveAddress(agent), ens: agent });
  }),

  // ── GET /boa/price?market=<id> ─────────────────────────────────────────────
  http.get(`${B}/boa/price`, async () => {
    await latency();
    return HttpResponse.json(priceQuote());
  }),

  // ── POST /boa/membership/buy ───────────────────────────────────────────────
  http.post(`${B}/boa/membership/buy`, async ({ request }) => {
    await latency();
    const body = (await request.json().catch(() => ({}))) as {
      agent?: string;
      market?: string;
      quantity?: number;
    };
    const agent = body.agent ?? '';
    const quantity = Math.max(1, Math.min(10, Math.floor(body.quantity ?? 1)));
    if (!agent) return HttpResponse.json({ error: 'missing agent' }, { status: 400 });
    if (market.sold + quantity > market.maxSupply) {
      return HttpResponse.json({ error: 'max supply reached for this market' }, { status: 409 });
    }

    const priceBefore = premiumAt(market.sold);
    const tokenIds: number[] = [];
    let pricePaid = 0;

    // Wrap one ERC-7527 voucher per unit; each wrap moves `sold` up the curve.
    for (let i = 0; i < quantity; i++) {
      const premium = premiumAt(market.sold);
      const fee = mintFee(premium);
      const unitCost = premium + fee;
      pricePaid += unitCost;
      const v = mintVoucher(agent, unitCost);
      tokenIds.push(v.tokenId);
      market.sold += 1;
    }
    const priceAfter = premiumAt(market.sold);

    return HttpResponse.json({
      tokenId: tokenIds[0],
      tokenIds,
      pricePaid: round(pricePaid),
      priceBefore: round(priceBefore),
      priceAfter: round(priceAfter),
    });
  }),

  // ── POST /boa/membership/transfer ──────────────────────────────────────────
  http.post(`${B}/boa/membership/transfer`, async ({ request }) => {
    await latency();
    const { tokenId, from, to } = (await request.json().catch(() => ({}))) as {
      tokenId?: number;
      from?: string;
      to?: string;
    };
    const v = tokenId != null ? findVoucher(tokenId) : undefined;
    if (!v) return HttpResponse.json({ error: 'voucher not found' }, { status: 404 });
    if (from && v.owner !== from) {
      return HttpResponse.json({ error: 'sender does not own this voucher' }, { status: 403 });
    }
    v.owner = to ?? v.owner;
    v.status = 'transferred'; // held by recipient but not yet usable until redeemed
    return HttpResponse.json({ tokenId: v.tokenId, from: from ?? '', to: v.owner });
  }),

  // ── POST /boa/membership/redeem ────────────────────────────────────────────
  http.post(`${B}/boa/membership/redeem`, async ({ request }) => {
    await latency();
    const { tokenId, agent } = (await request.json().catch(() => ({}))) as {
      tokenId?: number;
      agent?: string;
    };
    const v = tokenId != null ? findVoucher(tokenId) : undefined;
    if (!v) return HttpResponse.json({ error: 'voucher not found' }, { status: 404 });
    if (agent && v.owner !== agent) {
      return HttpResponse.json({ error: 'only the holder can redeem' }, { status: 403 });
    }
    v.status = 'redeemed'; // claim exercised → quota credited to the holder
    return HttpResponse.json({ tokenId: v.tokenId });
  }),

  // ── GET /boa/usage?agent=<ens> ─────────────────────────────────────────────
  http.get(`${B}/boa/usage`, async ({ request }) => {
    await latency();
    const agent = new URL(request.url).searchParams.get('agent') ?? '';
    const rows = agent ? ledger.filter((r) => r.agent === agent) : ledger;
    return HttpResponse.json(rows);
  }),

  // ── POST /v1/chat/completions  (OpenAI-compatible) ─────────────────────────
  http.post(`${B}/v1/chat/completions`, async ({ request }) => {
    await latency();

    const auth = request.headers.get('authorization') ?? '';
    const agent = auth.replace(/^Bearer\s+/i, '').trim();
    if (!agent) {
      return HttpResponse.json({ error: 'missing Authorization: Bearer <agent>' }, { status: 401 });
    }
    // Quota gate: an agent must hold usable quota (active or redeemed voucher).
    if (!hasAccess(agent)) {
      return HttpResponse.json(
        {
          error: `${agent} has no usable quota. Buy a membership, or redeem a voucher transferred to you.`,
        },
        { status: 402 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      model?: string;
      messages?: Array<{ role: string; content: string }>;
    };
    const model = body.model || 'boa-router/auto';
    const prompt = body.messages?.filter((m) => m.role === 'user').slice(-1)[0]?.content ?? '';

    const content = generateCompletion(prompt, agent);
    const prompt_tokens = estimateTokens(prompt);
    const completion_tokens = estimateTokens(content);
    const total_tokens = prompt_tokens + completion_tokens;

    // Spot metering: cost charged at the pre-call spot, which then drifts up with
    // utilization — so each receipt carries a real price_before/price_after.
    const price_before = round(spot.pricePer1k, 4);
    const cost = round((total_tokens / 1000) * price_before, 4);
    spot.pricePer1k = round(spot.pricePer1k * 1.012, 6);
    const price_after = round(spot.pricePer1k, 4);

    const id = `chatcmpl-${Math.random().toString(36).slice(2, 10)}`;
    const receipt: UsageReceipt = {
      id,
      agent,
      model,
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

    return HttpResponse.json(
      {
        id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens, completion_tokens, total_tokens },
      },
      {
        // The metering receipt rides on x-boa-usage (per the contract).
        headers: { 'x-boa-usage': JSON.stringify(receipt) },
      },
    );
  }),
];

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
