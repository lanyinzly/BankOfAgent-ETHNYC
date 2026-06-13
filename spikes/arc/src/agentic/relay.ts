// [3/3] The "relay" — a metered service that charges per usage via x402.
// Flow (x402 shape): client POSTs work -> relay replies 402 with payment requirements
// (price scaled by requested usage) -> client pays USDC on Arc and retries with an
// X-PAYMENT proof -> relay verifies the on-chain settlement, then serves the result.
//
// Settlement here is a real on-chain USDC transfer on Arc (verified from the receipt).
// The canonical x402 EVM "exact" scheme instead settles via EIP-3009
// transferWithAuthorization through a facilitator; that's the production upgrade path
// (see ../../README.md). Everything else — 402, accepts, X-PAYMENT, verify — mirrors it.
import "dotenv/config";
import http from "node:http";
import { ethers } from "ethers";
import { ARC, ERC20_ABI } from "./config";

const PRICE_PER_1K_TOKENS_USDC = 0.02; // demo price: $0.02 per 1,000 tokens

export interface RelayHandle {
  url: string;
  payTo: string;
  close: () => Promise<void>;
}

export async function startRelay(payTo: string, port = 0): Promise<RelayHandle> {
  const provider = new ethers.JsonRpcProvider(ARC.rpcUrl);
  const usdc = new ethers.Contract(ARC.usdc, ERC20_ABI, provider);
  const usedTx = new Set<string>(); // replay protection: a payment tx is spent once

  const priceForTokens = (tokens: number) =>
    ethers.parseUnits(((tokens / 1000) * PRICE_PER_1K_TOKENS_USDC).toFixed(6), ARC.decimals);

  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/infer")) {
      res.writeHead(404).end("not found");
      return;
    }
    const body = await readJson(req);
    const tokens = Math.max(1, Number(body?.max_tokens) || 256);
    const required = priceForTokens(tokens);
    const xpayment = req.headers["x-payment"] as string | undefined;

    // No payment yet -> 402 with payment requirements (price scaled by usage).
    if (!xpayment) {
      const accepts = [{
        scheme: "exact-onchain",
        network: ARC.key,
        asset: ARC.usdc,
        payTo,
        maxAmountRequired: required.toString(),
        decimals: ARC.decimals,
        resource: "/infer",
        description: `inference up to ${tokens} tokens`,
      }];
      res.writeHead(402, { "content-type": "application/json" });
      res.end(JSON.stringify({ x402Version: 1, accepts, error: "payment required" }));
      return;
    }

    // Payment present -> verify the on-chain settlement before serving.
    try {
      const proof = JSON.parse(Buffer.from(xpayment, "base64").toString());
      if (usedTx.has(proof.txHash)) { res.writeHead(409).end("payment already used"); return; }
      const v = await verifyPayment(provider, usdc, proof.txHash, payTo, required);
      if (!v.valid) {
        res.writeHead(402, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid payment", reason: v.reason }));
        return;
      }
      usedTx.add(proof.txHash);

      // Real work would go here; we simulate the inference.
      const result = {
        output: `inference(${tokens} tok) :: ${String(body?.prompt ?? "")}`.slice(0, 240),
        tokensCharged: tokens,
      };
      res.writeHead(200, {
        "content-type": "application/json",
        "x-payment-response": Buffer.from(JSON.stringify({ settled: true, txHash: proof.txHash, amount: required.toString() })).toString("base64"),
      });
      res.end(JSON.stringify(result));
    } catch (e: any) {
      res.writeHead(400).end(`bad payment: ${e?.message || e}`);
    }
  });

  await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  const addr = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${addr.port}`,
    payTo,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

async function verifyPayment(
  provider: ethers.JsonRpcProvider,
  usdc: ethers.Contract,
  txHash: string,
  payTo: string,
  required: bigint,
): Promise<{ valid: boolean; reason?: string }> {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt || receipt.status !== 1) return { valid: false, reason: "tx missing or failed" };
  const usdcAddr = (await usdc.getAddress()).toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== usdcAddr) continue;
    let parsed;
    try { parsed = usdc.interface.parseLog(log); } catch { continue; }
    if (parsed?.name === "Transfer") {
      const to = String(parsed.args[1]).toLowerCase();
      const value = parsed.args[2] as bigint;
      if (to === payTo.toLowerCase() && value >= required) return { valid: true };
    }
  }
  return { valid: false, reason: "no USDC Transfer to payTo >= required amount" };
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); } });
  });
}
