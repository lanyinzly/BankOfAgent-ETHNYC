/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Real BoA relay base URL. When set, the app talks to it directly and the
   *  in-browser mock is disabled. This is the ONLY thing you change to go live. */
  readonly NEXT_PUBLIC_RELAY_URL?: string;
  /** Optional Vite-native alias for the same setting. */
  readonly VITE_RELAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
