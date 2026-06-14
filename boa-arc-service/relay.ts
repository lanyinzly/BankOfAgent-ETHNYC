// The SELLER (relay) — a metered tool that charges per call via x402, settled in
// USDC on Arc. Deploy as its OWN Railway service. No private key lives here: it
// only VERIFIES the buyer's on-chain USDC Transfer (from the receipt) before
// serving. Replay-protected (a txHash is spent once). Mirrors spikes/arc relay.ts.
import express from "express";
import { ethers } from "ethers";
import { ARC, ERC20_ABI } from "./src/arc.ts";

const PORT = Number(process.env.PORT || 8080);
const PAY_TO = (process.env.RELAY_WALLET_ADDRESS || "").trim();
const PRICE_PER_1K = Number(process.env.RELAY_PRICE_PER_1K || "0.02"); // floor price
const ORIGIN = process.env.ALLOWED_ORIGIN || "*";

const provider = new ethers.JsonRpcProvider(ARC.rpcUrl);
const usdc = new ethers.Contract(ARC.usdc, ERC20_ABI, provider);
const usedTx = new Set<string>();
const priceForTokens = (tokens: number) =>
  ethers.parseUnits(((tokens / 1000) * PRICE_PER_1K).toFixed(6), ARC.decimals);

async function verifyPayment(txHash: string, required: bigint): Promise<{ valid: boolean; reason?: string }> {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt || receipt.status !== 1) return { valid: false, reason: "tx missing or failed" };
  const usdcAddr = ARC.usdc.toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== usdcAddr) continue;
    let parsed;
    try {
      parsed = usdc.interface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed?.name === "Transfer") {
      const to = String(parsed.args[1]).toLowerCase();
      const value = parsed.args[2] as bigint;
      if (to === PAY_TO.toLowerCase() && value >= required) return { valid: true };
    }
  }
  return { valid: false, reason: "no USDC Transfer to payTo >= required amount" };
}

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-PAYMENT");
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true, role: "seller-relay", network: ARC.key, payTo: PAY_TO || null }));
app.get("/", (_req, res) =>
  res.type("html").send(
    `<!doctype html><meta charset=utf-8><title>BoA × Arc · seller relay</title>` +
      `<body style="font:15px system-ui;background:#0b0e14;color:#e6edf3;max-width:640px;margin:8vh auto;padding:0 24px">` +
      `<h1>BoA × Arc — seller relay</h1><p style="color:#8b97a8">Metered tool charging per call via <b>x402</b>, settled in USDC on Arc testnet. ` +
      `POST <code>/infer</code> → 402 → pay USDC on Arc → retry with X-PAYMENT.</p>` +
      `<p>payTo: <code>${PAY_TO || "(set RELAY_WALLET_ADDRESS)"}</code> · floor ${PRICE_PER_1K}/1k tok</p></body>`,
  ),
);

app.post("/infer", async (req, res) => {
  if (!PAY_TO) {
    res.status(500).json({ error: "relay misconfigured: set RELAY_WALLET_ADDRESS" });
    return;
  }
  const tokens = Math.max(1, Number(req.body?.max_tokens) || 256);
  const required = priceForTokens(tokens);
  const xpayment = req.headers["x-payment"] as string | undefined;

  if (!xpayment) {
    res.writeHead(402, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        x402Version: 1,
        accepts: [
          {
            scheme: "exact-onchain",
            network: ARC.key,
            asset: ARC.usdc,
            payTo: PAY_TO,
            maxAmountRequired: required.toString(),
            decimals: ARC.decimals,
            resource: "/infer",
            description: `inference up to ${tokens} tokens`,
          },
        ],
        error: "payment required",
      }),
    );
    return;
  }

  try {
    const proof = JSON.parse(Buffer.from(xpayment, "base64").toString());
    if (usedTx.has(proof.txHash)) {
      res.status(409).json({ error: "payment already used" });
      return;
    }
    const v = await verifyPayment(proof.txHash, required);
    if (!v.valid) {
      res.status(402).json({ error: "invalid payment", reason: v.reason });
      return;
    }
    usedTx.add(proof.txHash);
    const result = {
      output: `inference(${tokens} tok) :: ${String(req.body?.prompt ?? "")}`.slice(0, 240),
      tokensCharged: tokens,
      settlement_tx: proof.txHash,
    };
    res.writeHead(200, {
      "content-type": "application/json",
      "x-payment-response": Buffer.from(JSON.stringify({ settled: true, txHash: proof.txHash, amount: required.toString() })).toString("base64"),
    });
    res.end(JSON.stringify(result));
  } catch (e: any) {
    res.status(400).json({ error: `bad payment: ${e?.message || e}` });
  }
});

app.listen(PORT, "0.0.0.0", () =>
  console.log(`BoA × Arc seller relay on :${PORT} (payTo ${PAY_TO || "UNSET"}, floor ${PRICE_PER_1K}/1k)`),
);
