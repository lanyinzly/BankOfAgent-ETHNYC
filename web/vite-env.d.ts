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
  /** BoA × Hedera agentic-payments API (boa-hedera-service). */
  readonly VITE_BOA_HEDERA_API?: string;
  readonly NEXT_PUBLIC_BOA_HEDERA_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
