// BoA Relay HTTP server. Implements interface contract v0 (see relay/README.md).
// The web demo session must stay byte-compatible with these routes.

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

export function buildApp(cfg: Config) {
  const identity = new StaticIdentityProvider();
  const settlement = new MockUsdcSettlement();
  const proof = new SignedReceiptProof(cfg.routerPrivateKey, cfg.receiptsFile);
  const getSigner = (addr: string) => identity.getByAddress(addr)?.privateKey ?? null;
  const adapter = createAdapter(cfg, getSigner);
  const membership = new MembershipService(adapter, cfg.quotaUsdcPerMembership);
  const upstream = new UpstreamModel(cfg.upstreamBaseUrl, cfg.upstreamApiKey);

  // Optionally pre-credit known agents so an external OpenAI client works
  // out-of-the-box (no explicit buy). Off by default; set on the always-on deploy.
  if (cfg.bootstrapQuotaUsdc > 0) {
    for (const a of identity.list()) membership.creditStandalone(a.address, cfg.bootstrapQuotaUsdc);
  }

  const app = express();
  app.use(express.json({ limit: "2mb" }));

  // Resolve an agent handle: api key OR ens OR 0x-address.
  function resolveAgent(handle: unknown): Agent | null {
    if (typeof handle !== "string" || !handle) return null;
    return identity.resolveByBearer(handle) ?? identity.resolve(handle);
  }

  const wrap =
    (fn: (req: any, res: any) => Promise<void>) =>
    (req: any, res: any) =>
      fn(req, res).catch((e: Error) => {
        console.error(`[relay] ${req.method} ${req.path} ->`, e.message);
        if (!res.headersSent) res.status(500).json({ error: { message: e.message, type: "boa_relay_error" } });
      });

  // ---- health ----
  app.get("/health", (_req: any, res: any) => {
    res.json({
      ok: true,
      service: "boa-relay",
      chainMode: adapter.mode,
      market: adapter.market().id,
      routerAddress: proof.routerAddress,
      upstream: upstream.isStub ? "stub-echo" : "forward",
    });
  });

  // Extract the agent credential from either an OpenAI-style `Authorization:
  // Bearer` header or an Anthropic-style `x-api-key` header. Value is an agent
  // API key OR an agent ENS name.
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
    });
  }

  function setUsageHeader(res: any, receipt: UsageReceipt, agent: Agent) {
    res.setHeader(
      "x-boa-usage",
      JSON.stringify({
        request_id: receipt.request_id,
        agent: agent.ens,
        membership_token_id: receipt.membership_token_id,
        input_tokens: receipt.input_tokens,
        output_tokens: receipt.output_tokens,
        total_cost_usdc: receipt.total_cost_usdc,
        settlement_tx: receipt.settlement_tx,
        quota_remaining_usdc: membership.availableQuota(agent.address),
        router_signature: receipt.router_signature,
      }),
    );
  }

  // Shared pipeline for both inference dialects: ① auth ② membership/quota
  // ③ forward to upstream (or stub) ④ meter + settle + sign receipt + header.
  async function handleInference(req: any, res: any, kind: "openai" | "anthropic") {
    const agent = identity.resolveByBearer(agentToken(req));
    if (!agent) {
      res.status(401).json({
        error: { message: "missing/invalid agent credential (Authorization: Bearer or x-api-key — agent key or ENS)", type: "auth" },
      });
      return;
    }
    if (!membership.hasAccess(agent.address)) {
      res.status(402).json({
        error: { message: `agent ${agent.ens} has no active membership or quota; POST /boa/membership/buy first`, type: "no_quota" },
      });
      return;
    }
    const requestId = "boa-req-" + randomUUID();
    const result =
      kind === "anthropic"
        ? await upstream.messages(req.body ?? {}, requestId)
        : await upstream.complete(req.body ?? {}, requestId);
    const receipt = await meterAndRecord(agent, result, requestId);
    setUsageHeader(res, receipt, agent);
    res.json(result.response);
  }

  // ---- OpenAI-compatible inference ----
  // POST /v1/chat/completions   Authorization: Bearer <agent-key | agent-ens>
  app.post("/v1/chat/completions", wrap((req, res) => handleInference(req, res, "openai")));

  // ---- Anthropic-native inference ----
  // POST /v1/messages   x-api-key: <agent-key | agent-ens>  (Bearer also accepted)
  app.post("/v1/messages", wrap((req, res) => handleInference(req, res, "anthropic")));

  // ---- FOAMM price (reads getWrapOracle) ----
  // GET /boa/price?market=<id>
  app.get(
    "/boa/price",
    wrap(async (req, res) => {
      const info = await adapter.price();
      res.json({
        market: info.market,
        requestedMarket: req.query.market ?? null,
        basePremium: info.basePremium,
        sold: info.sold,
        currentPremium: info.currentPremium,
        nextPremium: info.nextPremium,
        currency: info.currency,
        unit: "ETH",
        basePremiumWei: info.basePremiumWei,
        currentPremiumWei: info.currentPremiumWei,
        nextPremiumWei: info.nextPremiumWei,
      });
    }),
  );

  // ---- membership: buy (wrap) ----
  // POST /boa/membership/buy { agent, market? }
  app.post(
    "/boa/membership/buy",
    wrap(async (req, res) => {
      const agent = resolveAgent(req.body?.agent);
      if (!agent) {
        res.status(400).json({ error: { message: "unknown agent (provide agent ens/address/key)", type: "bad_request" } });
        return;
      }
      const r = await membership.buy(agent);
      res.json({
        tokenId: r.tokenId,
        pricePaid: r.pricePaid,
        priceBefore: r.priceBefore,
        priceAfter: r.priceAfter,
        quotaUsdc: r.quotaUsdc,
        owner: agent.ens,
        unit: "ETH",
        txHash: r.txHash ?? null,
      });
    }),
  );

  // ---- membership: redeem (unwrap) ----
  // POST /boa/membership/redeem { agent, tokenId }
  app.post(
    "/boa/membership/redeem",
    wrap(async (req, res) => {
      const agent = resolveAgent(req.body?.agent);
      if (!agent) {
        res.status(400).json({ error: { message: "unknown agent", type: "bad_request" } });
        return;
      }
      const tokenId = Number(req.body?.tokenId);
      if (!Number.isFinite(tokenId)) {
        res.status(400).json({ error: { message: "tokenId required", type: "bad_request" } });
        return;
      }
      const r = await membership.redeem(agent, tokenId);
      res.json({
        tokenId: r.tokenId,
        refund: r.refund,
        quotaCreditedUsdc: r.quotaCreditedUsdc,
        unit: "ETH",
        txHash: r.txHash ?? null,
      });
    }),
  );

  // ---- membership: transfer ----
  // POST /boa/membership/transfer { tokenId, from, to }
  app.post(
    "/boa/membership/transfer",
    wrap(async (req, res) => {
      const from = resolveAgent(req.body?.from);
      const to = resolveAgent(req.body?.to);
      const tokenId = Number(req.body?.tokenId);
      if (!from || !to) {
        res.status(400).json({ error: { message: "unknown from/to agent", type: "bad_request" } });
        return;
      }
      if (!Number.isFinite(tokenId)) {
        res.status(400).json({ error: { message: "tokenId required", type: "bad_request" } });
        return;
      }
      const r = await membership.transfer(tokenId, from, to);
      res.json({ tokenId, from: from.ens, to: to.ens, txHash: r.txHash ?? null });
    }),
  );

  // ---- usage receipts ----
  // GET /boa/usage?agent=<ens>
  app.get(
    "/boa/usage",
    wrap(async (req, res) => {
      const agentParam = typeof req.query.agent === "string" ? req.query.agent : undefined;
      // accept ens or address/key -> normalize to ens for filtering
      const agent = agentParam ? resolveAgent(agentParam) : null;
      const ens = agent?.ens ?? agentParam;
      res.json(proof.list(ens));
    }),
  );

  // ---- identity ----
  // GET /boa/identity?agent=<ens>
  app.get(
    "/boa/identity",
    wrap(async (req, res) => {
      const agent = resolveAgent(typeof req.query.agent === "string" ? req.query.agent : undefined);
      if (!agent) {
        res.status(404).json({ error: { message: "unknown agent", type: "not_found" } });
        return;
      }
      res.json({ address: agent.address, ens: agent.ens });
    }),
  );

  return { app, identity, settlement, proof, adapter, membership, upstream, cfg };
}
