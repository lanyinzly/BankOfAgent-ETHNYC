// ─────────────────────────────────────────────────────────────────────────────
// Relay client — the ONLY way the UI talks to the relay.
//
// Every method is a plain `fetch` against `${RELAY_URL}/...`. In mock mode MSW
// intercepts those exact requests in the browser; in live mode they hit the real
// relay. There is no second code path — switching is purely the base URL.
// ─────────────────────────────────────────────────────────────────────────────

import { CHAT_API_BASE, CHAT_API_KEY, CHAT_LIVE, CHAT_MODEL, RELAY_URL } from '../config';
import type {
  BuyResult,
  ChatResult,
  Identity,
  PriceQuote,
  RedeemResult,
  TransferResult,
  UsageReceipt,
} from '../types';

export class RelayError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'RelayError';
  }
}

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
    return fetch(`${RELAY_URL}/boa/identity?agent=${encodeURIComponent(agent)}`).then(ok<Identity>);
  },

  // GET /boa/price?market=<id>
  price(market: string): Promise<PriceQuote> {
    return fetch(`${RELAY_URL}/boa/price?market=${encodeURIComponent(market)}`).then(ok<PriceQuote>);
  },

  // POST /boa/membership/buy
  buy(body: { agent: string; market: string; quantity?: number }): Promise<BuyResult> {
    return fetch(`${RELAY_URL}/boa/membership/buy`, postInit(body)).then(ok<BuyResult>);
  },

  // POST /boa/membership/transfer
  transfer(body: { tokenId: number; from: string; to: string }): Promise<TransferResult> {
    return fetch(`${RELAY_URL}/boa/membership/transfer`, postInit(body)).then(ok<TransferResult>);
  },

  // POST /boa/membership/redeem
  redeem(body: { tokenId: number; agent: string }): Promise<RedeemResult> {
    return fetch(`${RELAY_URL}/boa/membership/redeem`, postInit(body)).then(ok<RedeemResult>);
  },

  // GET /boa/usage?agent=<ens>
  usage(agent: string): Promise<UsageReceipt[]> {
    return fetch(`${RELAY_URL}/boa/usage?agent=${encodeURIComponent(agent)}`).then(ok<UsageReceipt[]>);
  },

  // POST /v1/chat/completions  (OpenAI-compatible)
  //
  // Live: when a gateway key is configured, the call goes straight to the real
  // OpenAI-compatible gateway (CHAT_API_BASE) with the sk- key and CHAT_MODEL —
  // a real model round-trip. Mock: same OpenAI shape, served in-browser by MSW
  // at ${RELAY_URL}/v1, authed with the agent's ENS per the BoA contract.
  //
  // `opts.spot` is the live FOAMM spot (USDC / 1k tokens) used to meter the real
  // token usage the gateway returns (vanilla gateways don't emit x-boa-usage).
  async chat(agent: string, prompt: string, opts?: { spot?: number }): Promise<ChatResult> {
    const url = CHAT_LIVE
      ? `${CHAT_API_BASE}/v1/chat/completions`
      : `${RELAY_URL}/v1/chat/completions`;
    const model = CHAT_LIVE ? CHAT_MODEL : 'boa-router/auto';

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CHAT_LIVE ? CHAT_API_KEY : agent}`,
      },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
    });

    if (!res.ok) {
      let detail = '';
      try {
        const j = await res.json();
        // BoA mock returns { error: string }; OpenAI gateways return { error: { message } }.
        detail = (typeof j?.error === 'string' ? j.error : j?.error?.message) ?? '';
      } catch {
        /* ignore */
      }
      throw new RelayError(res.status, detail || `${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const header = res.headers.get('x-boa-usage');

    // The BoA mock rides the metering receipt on the x-boa-usage header. A vanilla
    // gateway doesn't, so meter its real token counts against the live FOAMM spot.
    let usage: UsageReceipt;
    if (header) {
      usage = JSON.parse(header) as UsageReceipt;
    } else {
      const total = data.usage?.total_tokens ?? 0;
      const spot = opts?.spot ?? 0;
      usage = {
        id: data.id,
        agent,
        model: data.model ?? model,
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
      model: data.model ?? model,
      content: data.choices?.[0]?.message?.content ?? '',
      usage,
    };
  },
};
