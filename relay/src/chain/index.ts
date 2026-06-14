// Chain adapter factory. Defaults to the in-memory FOAMM so the spine runs with
// no external dependencies; opts into the real Base Sepolia contracts only when
// CHAIN_MODE=onchain.

import type { ChainAdapter } from "../types.ts";
import type { Config } from "../config.ts";
import { InMemoryFoamm } from "./memory.ts";
import { OnchainFoamm, type SignerResolver } from "./onchain.ts";

export function createAdapter(cfg: Config, getSigner: SignerResolver): ChainAdapter {
  if (cfg.chainMode === "onchain") {
    return new OnchainFoamm(cfg.market, cfg.rpcUrl, getSigner);
  }
  return new InMemoryFoamm(cfg.market);
}
