// ─────────────────────────────────────────────────────────────────────────────
// Relay client — the ONLY way the UI talks to the relay.
//
// BoA mechanics (identity, price, vouchers, usage): in mock mode they run against
// the in-memory mockRelay (no network, no service worker); when a real relay URL
// is configured they hit it directly. The application code is identical either way.
//
// The model CALL is separate: when a gateway key is configured it goes straight to
// the OpenAI-compatible gateway (real inference); otherwise it uses the mock.
// ─────────────────────────────────────────────────────────────────────────────

import { CHAT_API_BASE, CHAT_API_KEY, CHAT_LIVE, CHAT_MODEL, RELAY_URL, USING_MOCK } from '../config';
import { RelayError } from './relayError';
import { mockRelay } from '../mocks/mockRelay';
import type {
  BuyResult,
  ChatResult,
  Identity,
  PriceQuote,
  RedeemResult,
  TransferResult,
  UsageReceipt,
} from '../types';

export { RelayError };

async function ok<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error ?? '';
    } catch {
      /* body was not JSON */
    }
    throw new RelayError(res.status, detail || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

function postInit(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const relay = {
  // GET /boa/identity?agent=<ens>
  identity(agent: string): Promise<Identity> {
    return USING_MOCK
      ? mockRelay.identity(agent)
      : fetch(`${RELAY_URL}/boa/identity?agent=${encodeURIComponent(agent)}`).then(ok<Identity>);
  },

  // GET /boa/price?market=<id>
  price(market: string): Promise<PriceQuote> {
    return USING_MOCK
      ? mockRelay.price(market)
      : fetch(`${RELAY_URL}/boa/price?market=${encodeURIComponent(market)}`).then(ok<PriceQuote>);
  },

  // POST /boa/membership/buy
  buy(body: { agent: string; market: string; quantity?: number }): Promise<BuyResult> {
    return USING_MOCK
      ? mockRelay.buy(body)
      : fetch(`${RELAY_URL}/boa/membership/buy`, postInit(body)).then(ok<BuyResult>);
  },

  // POST /boa/membership/transfer
  transfer(body: { tokenId: number; from: string; to: string }): Promise<TransferResult> {
    return USING_MOCK
      ? mockRelay.transfer(body)
      : fetch(`${RELAY_URL}/boa/membership/transfer`, postInit(body)).then(ok<TransferResult>);
  },

  // POST /boa/membership/redeem
  redeem(body: { tokenId: number; agent: string }): Promise<RedeemResult> {
    return USING_MOCK
      ? mockRelay.redeem(body)
      : fetch(`${RELAY_URL}/boa/membership/redeem`, postInit(body)).then(ok<RedeemResult>);
  },

  // GET /boa/usage?agent=<ens>
  usage(agent: string): Promise<UsageReceipt[]> {
    return USING_MOCK
      ? mockRelay.usage(agent)
      : fetch(`${RELAY_URL}/boa/usage?agent=${encodeURIComponent(agent)}`).then(ok<UsageReceipt[]>);
  },

  // POST /v1/chat/completions  (OpenAI-compatible)
  //
  // Live: when a gateway key is configured, the call goes straight to the real
  // OpenAI-compatible gateway (CHAT_API_BASE) with the sk- key and CHAT_MODEL — a
  // real model round-trip. Otherwise the in-memory mock answers.
  //
  // `opts.spot` is the live FOAMM spot (USDC / 1k tokens) used to meter the real
  // token usage the gateway returns (vanilla gateways don't emit x-boa-usage).
  async chat(agent: string, prompt: string, opts?: { spot?: number }): Promise<ChatResult> {
    if (!CHAT_LIVE) return mockRelay.chat(agent, prompt);

    const res = await fetch(`${CHAT_API_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CHAT_API_KEY}`,
      },
      body: JSON.stringify({ model: CHAT_MODEL, messages: [{ role: 'user', content: prompt }] }),
    });

    if (!res.ok) {
      let detail = '';
      try {
        const j = await res.json();
        // BoA returns { error: string }; OpenAI gateways return { error: { message } }.
        detail = (typeof j?.error === 'string' ? j.error : j?.error?.message) ?? '';
      } catch {
        /* ignore */
      }
      throw new RelayError(res.status, detail || `${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const header = res.headers.get('x-boa-usage');

    // A vanilla gateway returns real token counts but no x-boa-usage receipt, so
    // meter those tokens against the live FOAMM spot the app already tracks.
    let usage: UsageReceipt;
    if (header) {
      usage = JSON.parse(header) as UsageReceipt;
    } else {
      const total = data.usage?.total_tokens ?? 0;
      const spot = opts?.spot ?? 0;
      usage = {
        id: data.id,
        agent,
        model: data.model ?? CHAT_MODEL,
        prompt_tokens: data.usage?.prompt_tokens ?? 0,
        completion_tokens: data.usage?.completion_tokens ?? 0,
        total_tokens: total,
        cost: Math.round((total / 1000) * spot * 1e4) / 1e4,
        price_before: spot,
        price_after: spot,
        currency: 'USDC',
        timestamp: Date.now(),
      };
    }

    return {
      id: data.id,
      model: data.model ?? CHAT_MODEL,
      content: data.choices?.[0]?.message?.content ?? '',
      usage,
    };
  },
};
