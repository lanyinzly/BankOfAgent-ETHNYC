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
