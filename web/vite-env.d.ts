/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Real BoA relay base URL. When set, the app talks to it directly and the
   *  in-browser mock is disabled. This is the ONLY thing you change to go live. */
  readonly NEXT_PUBLIC_RELAY_URL?: string;
  /** Optional Vite-native alias for the same setting. */
  readonly VITE_RELAY_URL?: string;
  /** boa-ens-service base URL (ENS identity layer). */
  readonly VITE_ENS_API_BASE?: string;
  readonly NEXT_PUBLIC_ENS_API_BASE?: string;
  /** Read-only Sepolia RPC for client-side independent ENS re-resolution. */
  readonly VITE_SEPOLIA_RPC_URL?: string;
  readonly NEXT_PUBLIC_SEPOLIA_RPC_URL?: string;
  /** Model router/relay app (new-api console) linked from the nav. */
  readonly VITE_ROUTER_APP_URL?: string;
  /** OpenAI-compatible model gateway the demo's "Call a model" hits directly. */
  readonly VITE_CHAT_API_BASE?: string;
  /** sk- token for the gateway. Inlined into the public bundle — use a disposable,
   *  rate-limited token. Empty → the call falls back to the in-browser mock. */
  readonly VITE_CHAT_API_KEY?: string;
  /** Model id sent to the gateway (default: anthropic/claude-opus-4-6). */
  readonly VITE_CHAT_MODEL?: string;
  /** BoA × Hedera agentic-payments API (boa-hedera-service). */
  readonly VITE_BOA_HEDERA_API?: string;
  readonly NEXT_PUBLIC_BOA_HEDERA_API?: string;
  /** BoA × Arc agent-economy API (boa-arc-service). */
  readonly VITE_BOA_ARC_API?: string;
  readonly NEXT_PUBLIC_BOA_ARC_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
