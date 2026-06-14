// BoA Relay entrypoint. `node relay` (from the repo root) or `npm start` (from
// relay/) boots the gateway. No build step — Node 22 runs the TypeScript directly.

import { loadConfig } from "./src/config.ts";
import { buildApp } from "./src/server.ts";

const cfg = loadConfig();
const { app, proof, adapter } = buildApp(cfg);

app.listen(cfg.port, () => {
  console.log("");
  console.log("  Bank of Agent — Relay (spine)");
  console.log("  ─────────────────────────────");
  console.log(`  listening      http://127.0.0.1:${cfg.port}`);
  console.log(`  chain mode     ${adapter.mode}${adapter.mode === "onchain" ? ` (${cfg.rpcUrl})` : " (in-memory FOAMM — no external deps)"}`);
  console.log(`  market         ${cfg.market.id}  basePremium=${cfg.market.basePremium} wei`);
  console.log(`  router (proof) ${proof.routerAddress}`);
  console.log(`  upstream model ${cfg.upstreamBaseUrl ? cfg.upstreamBaseUrl : "stub-echo (set UPSTREAM_BASE_URL+UPSTREAM_API_KEY to forward)"}`);
  console.log("");
  console.log("  Try:  npm run demo");
  console.log("");
});
