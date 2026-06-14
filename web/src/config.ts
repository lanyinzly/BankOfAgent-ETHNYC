// ─────────────────────────────────────────────────────────────────────────────
// Runtime configuration. The ONE switch between mock and live is the relay URL.
// ─────────────────────────────────────────────────────────────────────────────

const configured = (
  import.meta.env.NEXT_PUBLIC_RELAY_URL ??
  import.meta.env.VITE_RELAY_URL ??
  ''
).trim();

/** True when no relay URL is configured → the in-browser mock relay serves the API. */
export const USING_MOCK = configured === '';

/**
 * Base URL every relay call is built on. In mock mode requests go to a
 * same-origin `/relay` path that MSW intercepts; in live mode they go straight
 * to the configured relay. The application code is identical either way.
 */
export const RELAY_URL = USING_MOCK ? '/relay' : configured.replace(/\/+$/, '');

/** What we show humans in code snippets / status when running on the mock. */
export const RELAY_DISPLAY_URL = USING_MOCK ? 'https://relay.boa.eth' : RELAY_URL;

// Static identities for the demo (the spec says: start with static identity).
export const AGENT_A = 'agent-a.boa.eth';
export const AGENT_B = 'agent-b.boa.eth';

// The forward-compute market this demo trades.
export const MARKET_ID = 'frontier-llm.q3';

// ─────────────────────────────────────────────────────────────────────────────
// Model gateway (OpenAI-compatible, e.g. New API on Railway). The actual model
// CALL in the demo ("Call a model" / "Second agent calls") hits THIS directly —
// base_url + an sk- key + a model id. Identity, vouchers and FOAMM pricing stay
// on the BoA relay/mock above; only the inference round-trip is real.
// ─────────────────────────────────────────────────────────────────────────────
export const CHAT_API_BASE = (
  import.meta.env.VITE_CHAT_API_BASE ??
  'https://boa-newapi-production.up.railway.app'
)
  .trim()
  .replace(/\/+$/, '');

/**
 * Gateway token. Set VITE_CHAT_API_KEY (e.g. in the Vercel project env).
 * SECURITY: Vite inlines this into the public client bundle, so anyone viewing
 * the site can read it — use a rate-limited / disposable token you can rotate.
 * Empty → the demo falls back to the in-browser mock response.
 */
export const CHAT_API_KEY = (import.meta.env.VITE_CHAT_API_KEY ?? '').trim();

/** Model id the demo calls through the gateway. */
export const CHAT_MODEL = (
  import.meta.env.VITE_CHAT_MODEL ?? 'anthropic/claude-opus-4-6'
).trim();

/** True when a gateway key is configured → real inference; else mock fallback. */
export const CHAT_LIVE = CHAT_API_KEY !== '';

/** Placeholder shown in copy-paste snippets — never the real key. */
export const CHAT_KEY_DISPLAY = 'sk-...';

// ─────────────────────────────────────────────────────────────────────────────
// ENS identity layer (boa-ens-service). LIVE-only: every name/address/record is
// read from real Sepolia ENS. Set VITE_ENS_API_BASE to the boa-ens-service URL.
// ─────────────────────────────────────────────────────────────────────────────
export const ENS_API_BASE = (
  import.meta.env.VITE_ENS_API_BASE ??
  import.meta.env.NEXT_PUBLIC_ENS_API_BASE ??
  ''
)
  .trim()
  .replace(/\/+$/, '');

/** Read-only Sepolia RPC the FRONTEND uses to INDEPENDENTLY re-resolve ENS names
 *  client-side (no private key ever in the browser). A public RPC is fine. */
export const ENS_READ_RPC = (
  import.meta.env.VITE_SEPOLIA_RPC_URL ??
  import.meta.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ??
  'https://ethereum-sepolia-rpc.publicnode.com'
).trim();

/** The model router/relay app (new-api console) — linked from the top nav. */
export const ROUTER_APP_URL = (
  import.meta.env.VITE_ROUTER_APP_URL ??
  'https://boa-newapi-production.up.railway.app/'
).trim();

/** BoA × Hedera agentic-payments API (boa-hedera-service). LIVE-only: prices, settles
 *  USDC on Hedera (HTS), and anchors a signed receipt on HCS. Empty → "configure" notice. */
export const HEDERA_API = (
  import.meta.env.VITE_BOA_HEDERA_API ??
  import.meta.env.NEXT_PUBLIC_BOA_HEDERA_API ??
  ''
)
  .trim()
  .replace(/\/+$/, '');

/** BoA × Arc agent-economy API (boa-arc-service). LIVE-only: agent-native price
 *  discovery + x402 USDC settlement on Arc testnet. Empty → "configure" notice. */
export const ARC_API = (
  import.meta.env.VITE_BOA_ARC_API ??
  import.meta.env.NEXT_PUBLIC_BOA_ARC_API ??
  ''
)
  .trim()
  .replace(/\/+$/, '');
