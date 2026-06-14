// ─────────────────────────────────────────────────────────────────────────────
// Relay client — the ONLY way the UI talks to the relay.
//
// Every method is a plain `fetch` against `${RELAY_URL}/...`. In mock mode MSW
// intercepts those exact requests in the browser; in live mode they hit the real
// relay. There is no second code path — switching is purely the base URL.
// ─────────────────────────────────────────────────────────────────────────────

import { RELAY_URL } from '../config';
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

  // POST /v1/chat/completions  (OpenAI-compatible; auth via Bearer <ens>)
  async chat(agent: string, prompt: string, model = 'boa-router/auto'): Promise<ChatResult> {
    const res = await fetch(`${RELAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agent}`,
      },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
    });

    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.json())?.error ?? '';
      } catch {
        /* ignore */
      }
      throw new RelayError(res.status, detail || `${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const header = res.headers.get('x-boa-usage');

    // The metering receipt rides on the x-boa-usage header (per contract). Fall
    // back to the OpenAI-style `usage` block in the body if it isn't exposed.
    const usage: UsageReceipt = header
      ? (JSON.parse(header) as UsageReceipt)
      : {
          id: data.id,
          agent,
          model: data.model,
          prompt_tokens: data.usage?.prompt_tokens ?? 0,
          completion_tokens: data.usage?.completion_tokens ?? 0,
          total_tokens: data.usage?.total_tokens ?? 0,
          cost: 0,
          price_before: 0,
          price_after: 0,
          currency: 'USDC',
          timestamp: Date.now(),
        };

    return {
      id: data.id,
      model: data.model,
      content: data.choices?.[0]?.message?.content ?? '',
      usage,
    };
  },
};
