// BoA Relay HTTP server. Implements relay interface contract v0 — the shape the
// web demo (web/src/lib/relayClient.ts + types.ts) consumes. Responses are a
// superset: contract-v0 fields plus BoA extras (router_signature, settlement_tx…).

import express from "express";
import type { Config } from "./config.ts";
import { StaticIdentityProvider } from "./identity.ts";
import { MockUsdcSettlement } from "./settlement.ts";
import { SignedReceiptProof } from "./proof.ts";
import { createAdapter } from "./chain/index.ts";
import { MembershipService } from "./membership.ts";
import { UpstreamModel } from "./upstream.ts";
import { costUsdc } from "./metering.ts";
import { randomUUID } from "node:crypto";
import type { Agent, UsageReceipt } from "./types.ts";

const CORS_ORIGIN = process.env.BOA_CORS_ORIGIN || "*";
// The web's default model id is a router alias; map it to a real upstream model.
function mapModel(m: unknown): string {
  const s = typeof m === "string" ? m.trim() : "";
  if (!s || s === "boa-router/auto" || s === "auto") return process.env.BOA_DEFAULT_MODEL || "claude-opus-4-6";
  return s;
}

// Internal receipt -> contract-v0 UsageReceipt (+ BoA extras the web ignores).
function toWebReceipt(r: UsageReceipt) {
  return {
    id: r.request_id,
    agent: r.agent_ens,
    model: r.model,
    prompt_tokens: r.input_tokens,
    completion_tokens: r.output_tokens,
    total_tokens: r.input_tokens + r.output_tokens,
    cost: r.total_cost_usdc,
    price_before: Number(r.price_before),
    price_after: Number(r.price_after),
    currency: "USDC",
    timestamp: r.timestamp,
    // extras (BoA narrative)
    membership_token_id: r.membership_token_id,
    settlement_tx: r.settlement_tx,
    router_signature: r.router_signature,
  };
}

export function buildApp(cfg: Config) {
  const identity = new StaticIdentityProvider();
  const settlement = new MockUsdcSettlement();
  const proof = new SignedReceiptProof(cfg.routerPrivateKey, cfg.receiptsFile);
  const getSigner = (addr: string) => identity.getByAddress(addr)?.privateKey ?? null;
  const adapter = createAdapter(cfg, getSigner);
  const membership = new MembershipService(adapter, cfg.quotaUsdcPerMembership);
  const upstream = new UpstreamModel(cfg.upstreamBaseUrl, cfg.upstreamApiKey);

  // Optionally pre-credit known agents (off by default). Leave 0 so the
  // buy→quota / redeem→quota / 402-otherwise narrative stays real for the demo.
  if (cfg.bootstrapQuotaUsdc > 0) {
    for (const a of identity.list()) membership.creditStandalone(a.address, cfg.bootstrapQuotaUsdc);
  }

  const app = express();
  app.use(express.json({ limit: "2mb" }));

  // CORS — required for the browser web demo to call this relay cross-origin and,
  // crucially, to READ the x-boa-usage metering header.
  app.use((req: any, res: any, next: any) => {
    res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, anthropic-version");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Expose-Headers", "x-boa-usage");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  const err = (res: any, status: number, message: string) => res.status(status).json({ error: message });

  function resolveAgent(handle: unknown): Agent | null {
    if (typeof handle !== "string" || !handle) return null;
    return identity.resolveByBearer(handle) ?? identity.resolve(handle);
  }

  const wrap =
    (fn: (req: any, res: any) => Promise<void>) =>
    (req: any, res: any) =>
      fn(req, res).catch((e: Error) => {
        console.error(`[relay] ${req.method} ${req.path} ->`, e.message);
        if (!res.headersSent) err(res, 500, e.message);
      });

  // ---- health ----
  app.get("/health", (_req: any, res: any) => {
    res.json({
      ok: true,
      service: "boa-relay",
      chainMode: adapter.mode,
      market: adapter.market().id,
      maxSupply: adapter.market().maxSupply,
      routerAddress: proof.routerAddress,
      upstream: upstream.isStub ? "stub-echo" : "forward",
      defaultModel: mapModel(undefined),
    });
  });

  // Agent credential from `Authorization: Bearer` OR `x-api-key` (agent key | ENS).
  function agentToken(req: any): string {
    const auth = req.headers["authorization"];
    if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7).trim();
    const xkey = req.headers["x-api-key"];
    if (typeof xkey === "string" && xkey) return xkey.trim();
    return "";
  }

  // Meter usage -> charge quota (mock USDC settle) -> sign a usage receipt.
  async function meterAndRecord(
    agent: Agent,
    result: { model: string; inputTokens: number; outputTokens: number },
    requestId: string,
  ): Promise<UsageReceipt> {
    const cost = costUsdc(result.inputTokens, result.outputTokens, cfg.priceInputPer1k, cfg.priceOutputPer1k);
    const charge = membership.charge(agent.address, cost);
    const settle = settlement.settle(agent, charge.charged, requestId);
    // FOAMM premium snapshot (a call does not move the curve, so before == after)
    const priceSnapshot = (await adapter.price()).currentPremium;
    return proof.record({
      request_id: requestId,
      agent_ens: agent.ens,
      membership_token_id: charge.membership_token_id,
      model: result.model,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      total_cost_usdc: charge.charged,
      settlement_tx: settle.settlement_tx,
      price_before: priceSnapshot,
      price_after: priceSnapshot,
      timestamp: Date.now(),
    });
  }

  function setUsageHeader(res: any, receipt: UsageReceipt, agent: Agent) {
    res.setHeader(
      "x-boa-usage",
      JSON.stringify({ ...toWebReceipt(receipt), quota_remaining_usdc: membership.availableQuota(agent.address) }),
    );
  }

  // Shared pipeline: ① auth ② membership/quota ③ upstream (or stub) ④ meter+receipt.
  async function handleInference(req: any, res: any, kind: "openai" | "anthropic") {
    const agent = identity.resolveByBearer(agentToken(req));
    if (!agent) {
      err(res, 401, "missing/invalid agent credential (Authorization: Bearer or x-api-key — agent key or ENS)");
      return;
    }
    if (!membership.hasAccess(agent.address)) {
      err(res, 402, `agent ${agent.ens} has no usable quota; POST /boa/membership/buy (or redeem a voucher) first`);
      return;
    }
    const requestId = "boa-req-" + randomUUID();
    const body = { ...(req.body ?? {}), model: mapModel(req.body?.model) };
    const result = kind === "anthropic" ? await upstream.messages(body, requestId) : await upstream.complete(body, requestId);
    const receipt = await meterAndRecord(agent, result, requestId);
    setUsageHeader(res, receipt, agent);
    res.json(result.response);
  }

  // ---- OpenAI-compatible inference ----  Authorization: Bearer <agent-key | ENS>
  app.post("/v1/chat/completions", wrap((req, res) => handleInference(req, res, "openai")));
  // ---- Anthropic-native inference ----   x-api-key: <agent-key | ENS> (Bearer ok)
  app.post("/v1/messages", wrap((req, res) => handleInference(req, res, "anthropic")));

  // ---- FOAMM price ----  GET /boa/price?market=<id>
  app.get(
    "/boa/price",
    wrap(async (req, res) => {
      const info = await adapter.price();
      const m = adapter.market();
      res.json({
        market: (typeof req.query.market === "string" && req.query.market) || info.market,
        basePremium: Number(info.basePremium),
        sold: info.sold,
        maxSupply: m.maxSupply,
        currentPremium: Number(info.currentPremium),
        nextPremium: Number(info.nextPremium),
        currency: "USDC",
        // exact wei companions (BoA extras)
        basePremiumWei: info.basePremiumWei,
        currentPremiumWei: info.currentPremiumWei,
        nextPremiumWei: info.nextPremiumWei,
      });
    }),
  );

  // ---- membership: buy (wrap) ----  POST { agent, market?, quantity? }
  app.post(
    "/boa/membership/buy",
    wrap(async (req, res) => {
      const agent = resolveAgent(req.body?.agent);
      if (!agent) return err(res, 400, "unknown agent (provide agent ens/address/key)");
      const quantity = Number(req.body?.quantity) || 1;
      const r = await membership.buy(agent, quantity);
      res.json({
        tokenId: r.tokenId,
        tokenIds: r.tokenIds,
        pricePaid: r.pricePaid,
        priceBefore: r.priceBefore,
        priceAfter: r.priceAfter,
        quotaUsdc: r.quotaUsdc,
        owner: agent.ens,
        txHashes: r.txHashes,
      });
    }),
  );

  // ---- membership: redeem (unwrap) ----  POST { agent, tokenId }
  app.post(
    "/boa/membership/redeem",
    wrap(async (req, res) => {
      const agent = resolveAgent(req.body?.agent);
      if (!agent) return err(res, 400, "unknown agent");
      const tokenId = Number(req.body?.tokenId);
      if (!Number.isFinite(tokenId)) return err(res, 400, "tokenId required");
      const r = await membership.redeem(agent, tokenId);
      res.json({ tokenId: r.tokenId, refund: r.refund, quotaCreditedUsdc: r.quotaCreditedUsdc, txHash: r.txHash ?? null });
    }),
  );

  // ---- membership: transfer ----  POST { tokenId, from, to }
  app.post(
    "/boa/membership/transfer",
    wrap(async (req, res) => {
      const from = resolveAgent(req.body?.from);
      const to = resolveAgent(req.body?.to);
      const tokenId = Number(req.body?.tokenId);
      if (!from || !to) return err(res, 400, "unknown from/to agent");
      if (!Number.isFinite(tokenId)) return err(res, 400, "tokenId required");
      const r = await membership.transfer(tokenId, from, to);
      res.json({ tokenId, from: from.ens, to: to.ens, txHash: r.txHash ?? null });
    }),
  );

  // ---- usage receipts ----  GET /boa/usage?agent=<ens>
  app.get(
    "/boa/usage",
    wrap(async (req, res) => {
      const agentParam = typeof req.query.agent === "string" ? req.query.agent : undefined;
      const agent = agentParam ? resolveAgent(agentParam) : null;
      const ens = agent?.ens ?? agentParam;
      res.json(proof.list(ens).map(toWebReceipt));
    }),
  );

  // ---- identity ----  GET /boa/identity?agent=<ens>
  app.get(
    "/boa/identity",
    wrap(async (req, res) => {
      const agent = resolveAgent(typeof req.query.agent === "string" ? req.query.agent : undefined);
      if (!agent) return err(res, 404, "unknown agent");
      res.json({ address: agent.address, ens: agent.ens });
    }),
  );

  return { app, identity, settlement, proof, adapter, membership, upstream, cfg };
}
