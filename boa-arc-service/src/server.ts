// BoA × Arc — backend API for the agent-economy demo.
//   GET  /api/balances              buyer + seller USDC balances on Arc
//   GET  /api/tools                 the mini agent marketplace (1..N seller tools)
//   GET  /api/price?tool&maxTokens  FOAMM demand curve + the live discovered price
//   POST /api/agent/buy             run the x402 purchase; returns an animatable step log
//   POST /api/settle                a plain 1-USDC transfer on Arc (proof of settlement)
// Keys are server-side only (env). USDC = 6-dp ERC-20 at 0x3600… on Arc testnet.
import express from "express";
import { ethers } from "ethers";
import { ARC, fmt, txUrl, addrUrl, usdcBalance, usdcTransfer } from "./arc.ts";
import { listTools, getTool, quote, priceAt, priceUnits, recordSale } from "./price.ts";
import { buyWithX402 } from "./x402.ts";

const ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const AGENT_KEY = (process.env.AGENT_PRIVATE_KEY || "").trim();
const RELAY_URL = (process.env.RELAY_URL || "").trim().replace(/\/+$/, "");
const SELLER = (process.env.RELAY_WALLET_ADDRESS || "").trim();
const RECIPIENT = (process.env.RECIPIENT || SELLER).trim();
const buyerAddress = AGENT_KEY ? new ethers.Wallet(AGENT_KEY).address : null;

export function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", ORIGIN);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  const err = (res: any, code: number, message: string) => res.status(code).json({ error: message });
  const wrap =
    (fn: (req: any, res: any) => Promise<void>) =>
    (req: any, res: any) =>
      fn(req, res).catch((e: Error) => {
        console.error(`[arc] ${req.method} ${req.path} ->`, e.message);
        if (!res.headersSent) err(res, 500, e.message);
      });

  app.get("/health", (_req: any, res: any) =>
    res.json({
      ok: true,
      service: "boa-arc-service",
      network: ARC.key,
      chainId: ARC.chainId,
      buyer: buyerAddress,
      seller: SELLER || null,
      relay: RELAY_URL || null,
      ready: !!(AGENT_KEY && RELAY_URL && SELLER),
    }),
  );

  app.get(
    "/api/balances",
    wrap(async (_req, res) => {
      const [buyerBal, sellerBal] = await Promise.all([
        buyerAddress ? usdcBalance(buyerAddress) : Promise.resolve(0n),
        SELLER ? usdcBalance(SELLER) : Promise.resolve(0n),
      ]);
      res.json({
        chainId: ARC.chainId,
        explorer: ARC.explorer,
        buyer: { address: buyerAddress, usdc: fmt(buyerBal), link: buyerAddress ? addrUrl(buyerAddress) : null },
        seller: { address: SELLER || null, usdc: fmt(sellerBal), link: SELLER ? addrUrl(SELLER) : null },
      });
    }),
  );

  app.get("/api/tools", (_req: any, res: any) => res.json(listTools()));

  app.get(
    "/api/price",
    wrap(async (req, res) => {
      const t = getTool(String(req.query.tool || "gpt-4o"));
      if (!t) return err(res, 404, "unknown tool");
      const maxTokens = Math.max(1, Number(req.query.maxTokens) || 512);
      res.json(quote(t, maxTokens));
    }),
  );

  app.post(
    "/api/agent/buy",
    wrap(async (req, res) => {
      const t = getTool(String(req.body?.tool || "gpt-4o"));
      if (!t) return err(res, 404, "unknown tool");
      if (!AGENT_KEY || !RELAY_URL || !SELLER) {
        return err(res, 503, "buy disabled: set AGENT_PRIVATE_KEY, RELAY_URL, RELAY_WALLET_ADDRESS");
      }
      const maxTokens = Math.max(1, Math.min(Number(req.body?.maxTokens) || 512, 8192));
      const prompt = String(req.body?.prompt || "price one agent tool call");

      const soldBefore = t.soldUnits;
      const discovered = priceAt(t, maxTokens, soldBefore);
      const pay = priceUnits(t, maxTokens, soldBefore);

      const [buyerBefore, sellerBefore] = await Promise.all([usdcBalance(buyerAddress!), usdcBalance(SELLER)]);

      const out = await buyWithX402({ relayUrl: RELAY_URL, agentKey: AGENT_KEY, payUnits: pay, prompt, maxTokens });

      const soldAfter = recordSale(t.id);
      const newPrice = priceAt(t, maxTokens, soldAfter);
      const [buyerAfter, sellerAfter] = await Promise.all([usdcBalance(buyerAddress!), usdcBalance(SELLER)]);

      res.json({
        tool: t.id,
        steps: [
          { k: "discover", label: "Price discovered on-chain by demand", priceUsdc: discovered.toFixed(6), soldUnitsBefore: soldBefore },
          { k: "request", label: "Buyer Agent → Seller: POST /infer (x402)" },
          { k: "quote", label: "Seller → 402 Payment Required", priceUsdc: fmt(out.floorRequired), maxTokens },
          { k: "pay", label: "Buyer Agent → Arc: USDC transfer", txHash: out.txHash, explorerUrl: txUrl(out.txHash) },
          { k: "verify", label: "Seller verifies payment on Arc" },
          { k: "deliver", label: "Seller → result delivered", result: out.result },
          { k: "reprice", label: "Curve advances — demand discovered a higher price", soldUnitsAfter: soldAfter, newPriceUsdc: newPrice.toFixed(6) },
        ],
        paidUsdc: fmt(out.paid),
        txHash: out.txHash,
        explorerUrl: txUrl(out.txHash),
        balances: {
          buyerBefore: fmt(buyerBefore),
          buyerAfter: fmt(buyerAfter),
          sellerBefore: fmt(sellerBefore),
          sellerAfter: fmt(sellerAfter),
        },
      });
    }),
  );

  app.post(
    "/api/settle",
    wrap(async (req, res) => {
      if (!AGENT_KEY || !RECIPIENT) return err(res, 503, "settle disabled: set AGENT_PRIVATE_KEY + RECIPIENT");
      const amount = ethers.parseUnits(String(req.body?.amount || "1"), ARC.decimals);
      const [a0, b0] = await Promise.all([usdcBalance(buyerAddress!), usdcBalance(RECIPIENT)]);
      const txHash = await usdcTransfer(AGENT_KEY, RECIPIENT, amount);
      const [a1, b1] = await Promise.all([usdcBalance(buyerAddress!), usdcBalance(RECIPIENT)]);
      res.json({
        txHash,
        explorerUrl: txUrl(txHash),
        amount: fmt(amount),
        from: buyerAddress,
        to: RECIPIENT,
        before: { a: fmt(a0), b: fmt(b0) },
        after: { a: fmt(a1), b: fmt(b1) },
      });
    }),
  );

  app.get("/", (_req: any, res: any) =>
    res.type("html").send(
      `<!doctype html><meta charset=utf-8><title>BoA × Arc · API</title>` +
        `<body style="font:15px system-ui;background:#0b0e14;color:#e6edf3;max-width:680px;margin:8vh auto;padding:0 24px">` +
        `<h1>BoA × Arc — agent-economy API</h1>` +
        `<p style="color:#8b97a8">Agent-native price discovery + x402 USDC settlement on Arc testnet (Circle Agent Stack).</p>` +
        `<p>GET <code>/api/balances</code> · <code>/api/tools</code> · <code>/api/price?tool=gpt-4o&maxTokens=512</code><br>` +
        `POST <code>/api/agent/buy</code> · <code>/api/settle</code></p>` +
        `<p>buyer: <code>${buyerAddress || "(set AGENT_PRIVATE_KEY)"}</code><br>seller: <code>${SELLER || "(set RELAY_WALLET_ADDRESS)"}</code></p>` +
        `</body>`,
    ),
  );

  return app;
}
