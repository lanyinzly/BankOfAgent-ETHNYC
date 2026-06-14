// Deployable entrypoint for the BoA Arc relay (the x402 "seller" service).
// Binds 0.0.0.0:$PORT (Railway injects PORT). Receives USDC on Arc; holds NO private key.
//
// Required env:  RELAY_WALLET_ADDRESS  (the seller wallet that receives USDC on Arc)
// Optional env:  ARC_RPC_URL (defaults to https://rpc.testnet.arc.network), PORT
//
// Endpoints:  POST /infer  (x402: 402 -> pay on Arc -> verify -> result)   ·   GET /health
import "dotenv/config";
import { startRelay } from "./relay";

const port = Number(process.env.PORT) || 8080;
const payTo = process.env.RELAY_WALLET_ADDRESS || process.env.WALLET_B_ADDRESS;

if (!payTo) {
  console.error("FATAL: set RELAY_WALLET_ADDRESS (the seller wallet address that receives USDC on Arc).");
  process.exit(1);
}

startRelay(payTo, port, "0.0.0.0")
  .then((relay) => {
    console.log(`BoA Arc relay (x402 seller) listening on :${port}`);
    console.log(`  payTo (seller): ${relay.payTo}`);
    console.log(`  endpoints:      POST /infer   ·   GET /health`);
  })
  .catch((e) => {
    console.error("relay failed to start:", e?.message || e);
    process.exit(1);
  });
