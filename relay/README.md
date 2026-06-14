# BoA Relay (spine)

The **Router / Relay** from the Bank of Agent architecture: an OpenAI-compatible
gateway that sits in front of the ERC-7527 **FOAMM membership market**. It answers
two questions on every call — *who is this agent?* (identity) and *what did it
consume?* (metered, signed usage) — then settles and prices against the market.

```
ENS (identity, STUB)              Hedera HCS (proof, STUB)
 agent-a.boa.eth                   signed, tamper-evident usage log
      │                                   ▲
      │ who                               │ what was consumed
      ▼                                   │
 ┌──────────────────────────────────────────────┐
 │            ROUTER / RELAY  (this service)      │
 │  1. resolve agent  (Bearer key / ENS)          │
 │  2. check membership / quota                   │
 │  3. route to model + meter usage               │
 │  4. settle per-call in USDC  (Arc, STUB)       │
 │  5. emit a SIGNED usage receipt  (HCS, STUB)   │
 └──────────────────────────────────────────────┘
      │ pays                          │ prices
      ▼                               ▼
 Arc / USDC  (STUB)            Base Sepolia
                              ERC-7527 FOAMM membership
```

This is the **spine**: it runs end-to-end with **every external rail stubbed**
(no ENS, no Arc, no Hedera, and not even a chain). The defaults are chosen so that
`node relay` + `npm run demo` works with zero configuration.

---

## Quickstart

```bash
cd relay
npm install
node ../relay        # or: npm start        (boots the gateway on :8787)
npm run demo         # in another shell — runs the full closed loop
```

> No build step. Node 22 (>= 22.6) runs the TypeScript directly via native type
> stripping. `node relay` from the repo root works because `relay/package.json`
> points `main` at `index.ts`.

`npm run demo` prints, in order: the FOAMM price rising as a membership is bought,
a successful model call, a **signed usage receipt**, the voucher transferred to a
second agent, that agent **redeeming the voucher into quota**, and the second
agent making a successful call. (If no relay is running, the demo boots one
in-process so it always runs.)

---

## Interface contract v0

> **Canonical contract = `web/src/types.ts` + `web/src/lib/relayClient.ts`.** The
> relay now matches it exactly (the web is the consumer / source of truth):
> - `/boa/price` and `/boa/membership/buy` return **numbers** (USDC), and `/boa/price`
>   includes **`maxSupply`**.
> - `/boa/usage` and the `x-boa-usage` header use the web **`UsageReceipt`** shape
>   `{ id, agent, model, prompt_tokens, completion_tokens, total_tokens, cost,
>   price_before, price_after, currency, timestamp }` (+ BoA extras: `settlement_tx`,
>   `router_signature`, `membership_token_id`, `quota_remaining_usdc`).
> - 4xx bodies are `{ "error": string }`.
> - **CORS** is enabled with `Access-Control-Expose-Headers: x-boa-usage` (set the
>   allowed origin via `BOA_CORS_ORIGIN`).
> - The web's default model id `boa-router/auto` is mapped to a real upstream model
>   (`BOA_DEFAULT_MODEL`, default `claude-opus-4-6`).
> - **Memory mode** (the always-on web demo) defaults to the web's economics:
>   basePremium **10**, maxSupply **30**, **0.5%** fees, market `frontier-llm.q3`.
>   **Onchain mode** still mirrors the deployed contract via `deployments.json`.

### `POST /v1/chat/completions` — OpenAI compatible
- **Header:** `Authorization: Bearer <agent-key | agent-ENS>`
- **Behaviour:**
  1. resolve & authenticate the agent (api key or ENS name),
  2. verify the agent holds a valid **membership / quota** (else `402`),
  3. forward to the upstream model (or a **stub echo** model when no upstream key
     is configured),
  4. meter `usage`, settle the per-call cost in (mock) USDC, decrement quota,
  5. return an OpenAI-shaped `chat.completion`, with a `x-boa-usage` response header.
- **`x-boa-usage` header** (JSON): `{ request_id, agent, membership_token_id,
  input_tokens, output_tokens, total_cost_usdc, settlement_tx,
  quota_remaining_usdc, router_signature }`.

### `POST /v1/messages` — Anthropic native
- **Header:** `x-api-key: <agent-key | agent-ENS>` (`Authorization: Bearer` also accepted)
- Same pipeline as above (auth → membership/quota → forward → meter → settle →
  signed receipt), but speaks the **Anthropic Messages API** shape on the way in
  and out, and forwards to the upstream `/v1/messages`. Returns an Anthropic
  `message` object (`{ type:"message", role:"assistant", content:[{type:"text",…}],
  usage:{ input_tokens, output_tokens }, … }`) plus the same `x-boa-usage` header.
- Lets an **Anthropic SDK** client use the shim URL as `base_url` directly, just
  like the OpenAI endpoint above.

### `GET /boa/price?market=<id>`
Reads the on-chain `getWrapOracle` (or the in-memory mirror).
→ `{ market, sold, basePremium, currentPremium, nextPremium, currency, unit:"ETH",
   basePremiumWei, currentPremiumWei, nextPremiumWei }`

### `POST /boa/membership/buy`  `{ agent, market? }`
Calls `wrap` — mints a voucher to the agent and moves the FOAMM curve up.
→ `{ tokenId, pricePaid, priceBefore, priceAfter, quotaUsdc, owner, unit:"ETH", txHash }`

### `POST /boa/membership/redeem`  `{ agent, tokenId }`
Calls `unwrap` — burns the voucher, refunds the FOAMM premium, and credits the
remaining usage allowance to the redeemer as standalone quota.
→ `{ tokenId, refund, quotaCreditedUsdc, unit:"ETH", txHash }`

### `POST /boa/membership/transfer`  `{ tokenId, from, to }`
Transfers the ERC-721 voucher (and its remaining quota) between agents.
→ `{ tokenId, from, to }`

### `GET /boa/usage?agent=<ens>`
→ array of **usage receipts** (see schema below), filtered by agent.

### `GET /boa/identity?agent=<ens>`
→ `{ address, ens }`

### `GET /health`
→ `{ ok, service, chainMode, market, routerAddress, upstream }`

`agent` in any request body / query accepts an **agent key, an ENS name, or a
0x address** — all resolve through the identity rail.

---

## Usage receipt schema

Every metered call produces this object (contract-v0 `UsageReceipt` + BoA extras).
`router_signature` is a real ECDSA signature by the relay's router key — so *every
call == one signed usage receipt*, ready to publish to Hedera HCS later.

```jsonc
{
  "id":                  "boa-req-…",       // request id
  "agent":               "agent-a.boa.eth",
  "model":               "claude-opus-4-6",
  "prompt_tokens":       15,
  "completion_tokens":   58,
  "total_tokens":        73,
  "cost":                0.000095,          // USDC drawn from quota
  "price_before":        10.1,              // FOAMM premium snapshot (number)
  "price_after":         10.1,              // a call does not move the curve, so ==
  "currency":            "USDC",
  "timestamp":           1781400000000,
  // ── BoA extras (web ignores) ──
  "membership_token_id": 1,                 // or null
  "settlement_tx":       "0x…",             // mock USDC settlement ref (Arc later)
  "router_signature":    "0x…"              // ECDSA over the receipt body
}
```

---

## Quota / membership model

Reconciles the on-chain ERC-7527 mechanics (`wrap` / `unwrap`) with the
"redeem the voucher into quota" narrative — and makes the redeem step **real**:

- **Buy (`wrap`)** mints ERC-7527 voucher(s) to the buyer **and** credits the buyer
  callable quota (`BOA_QUOTA_USDC`, default `5` USDC per voucher; `quantity` mints N).
- **Holding a voucher is NOT enough to call** — only bought/redeemed quota is. So an
  agent that was *transferred* an un-redeemed voucher has **no quota and gets `402`**
  until it redeems. (`hasAccess(agent) = callableQuota(agent) > 0`.)
- **Transfer** moves the voucher (the claim) but **not** quota.
- **Redeem (`unwrap`)** burns the voucher, returns the FOAMM premium on-chain, and
  **credits the redeemer quota** — unlocking the second agent's calls (the demo's
  closing step).
- `BOA_BOOTSTRAP_QUOTA_USDC` (default `0`) can pre-credit known agents; keep it `0`
  so the buy→quota / redeem→quota / 402-otherwise narrative stays real.

---

## External rails — all STUBBED (clear seams for other tracks)

| Rail | Today (stub) | Later | Interface |
| --- | --- | --- | --- |
| **identity** | static ENS→agent map (`src/identity.ts`) | real ENS resolver | `IdentityProvider` |
| **settlement** | mock USDC ledger + fake tx hash (`src/settlement.ts`) | Arc / USDC | `SettlementProvider` |
| **proof** | router-signed receipts → JSONL + memory (`src/proof.ts`) | Hedera HCS topic | `ProofSink` |
| **chain** | in-memory FOAMM (`src/chain/memory.ts`) | Base Sepolia ERC-7527 (`src/chain/onchain.ts`) | `ChainAdapter` |

The two demo agents (`agent-a.boa.eth`, `agent-b.boa.eth`) reuse public anvil test
accounts so the optional onchain mode works out of the box against a local node.

---

## Configuration (env)

| Var | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | HTTP port |
| `CHAIN_MODE` | `memory` | `memory` (default, no deps) or `onchain` |
| `BASE_SEPOLIA_RPC_URL` | `https://sepolia.base.org` | RPC for onchain mode |
| `ROUTER_PRIVATE_KEY` | (public anvil key) | key that signs usage receipts |
| `BOA_QUOTA_USDC` | `5` | usage allowance attached to each membership |
| `BOA_PRICE_INPUT_PER_1K` | `0.0005` | USDC per 1k input tokens |
| `BOA_PRICE_OUTPUT_PER_1K` | `0.0015` | USDC per 1k output tokens |
| `RPC_URL` | by chainId | onchain RPC (auto: 84532→Base Sepolia, 11155111→Ethereum Sepolia) |
| `AGENT_A_PRIVATE_KEY` / `AGENT_B_PRIVATE_KEY` | (public anvil keys) | fresh funded keys for the demo agents in onchain mode; address is derived from the key |
| `UPSTREAM_BASE_URL` | — | OpenAI-compatible upstream (e.g. a [new-api](https://github.com/QuantumNous/new-api) instance). Unset → stub echo |
| `UPSTREAM_API_KEY` | — | bearer for the upstream |
| `BOA_BASE_PREMIUM` / `BOA_MINT_FEE_PERCENT` / `BOA_BURN_FEE_PERCENT` | from `deployments.json` or DeployBoA defaults | FOAMM curve params |

### Onchain mode

```bash
# after deploying (see ../contracts/README.md) so contracts/deployments.json exists.
# Supply FRESH funded keys for the two demo agents — the default keys are public
# anvil keys, and on a public testnet any ETH sent to them is swept by bots.
CHAIN_MODE=onchain \
  AGENT_A_PRIVATE_KEY=0x<funded> \
  AGENT_B_PRIVATE_KEY=0x<funded> \
  node ../relay      # RPC auto-selected from deployments.json chainId; override with RPC_URL
```

In `onchain` mode the relay reads `../contracts/deployments.json` for the market
addresses and sends real `wrap`/`unwrap`/`transferFrom` transactions; the responses
include the on-chain `txHash`. Each acting agent must have a funded key (above).
FOAMM prices are read live from the on-chain `getWrapOracle`. The off-chain quota
ledger is identical in both modes.

> This exact flow was run live on **Ethereum Sepolia** (chainId 11155111): a real
> `wrap` (curve moved up) → transfer → `unwrap` (refund) → second agent called
> successfully. See `../contracts/README.md` for the deployed addresses.

> **Relation to new-api:** this relay is a deliberately lightweight, dependency-free
> reimplementation of the new-api gateway idea (bearer auth + usage metering +
> OpenAI-compatible forwarding). To use a real new-api / QuantumNous deployment as
> the model backend, point `UPSTREAM_BASE_URL`/`UPSTREAM_API_KEY` at it.

## Deploy on Railway (always-on)

Target topology: **one Railway project, two services**, each with its own
auto-assigned public HTTPS URL. The shim talks to new-api over Railway **private
networking**. All secrets live in **Railway Variables** — never in the repo.

```
            (public HTTPS)                         (public HTTPS)
 external OpenAI client ──▶  shim  ──private──▶  new-api  ──▶  model providers
   base_url = shim URL      (this repo,         (official      (OpenAI/Anthropic/…
   key = agent key/ENS       relay/)             image,         configured in new-api)
                             FOAMM + quota        SQLite@/data)
                             + signed receipts
```

Repo artifacts: [`Dockerfile`](./Dockerfile) + [`railway.json`](./railway.json)
(shim build/deploy + `/health` healthcheck). new-api uses its official image, so
it needs no Dockerfile — just the settings below.

### Service ① `new-api` (model gateway)

1. **New Service → Docker Image** → `calciumion/new-api:latest`.
2. **Add a Volume**, mount path `/data` (new-api keeps its **SQLite** DB + logs
   there — no separate Postgres needed).
3. **Variables:**
   - `SESSION_SECRET` = a long random string (required for stable sessions)
   - `CRYPTO_SECRET` = a long random string
   - `TZ` = `UTC` (optional)
   - (leave `SQL_DSN` unset → SQLite at `/data`)
4. **Generate Domain** (public HTTPS).
5. Open the new-api admin (default root login), add a **Channel** (your model
   provider + that provider's **API key** — this key lives only in new-api), then
   create a **Token**. That token is the shim's `UPSTREAM_API_KEY`.

### Service ② `shim` (this repo, BoA relay)

1. **New Service → GitHub Repo** → this repo. Set **Root Directory** to `relay`
   (Railway then uses `relay/railway.json` → builds `relay/Dockerfile`).
2. **Variables:**
   - `UPSTREAM_BASE_URL` = `http://${{new-api.RAILWAY_PRIVATE_DOMAIN}}:${{new-api.PORT}}/v1`
     — the New API internal address via private networking
   - `UPSTREAM_API_KEY` = the new-api token from step ①.5  *(secret)*
   - `ROUTER_PRIVATE_KEY` = the key that signs usage receipts  *(secret)*
   - `BOA_BOOTSTRAP_QUOTA_USDC` = `5` — so an external client works with just an
     agent key (no explicit on-chain buy first)
   - contract addresses (informational in memory mode; required for onchain mode):
     `BOA_AGENCY`, `BOA_APP`, `BOA_CHAIN_ID`
   - optional onchain mode: `CHAIN_MODE=onchain`, `RPC_URL`,
     `AGENT_A_PRIVATE_KEY`, `AGENT_B_PRIVATE_KEY` *(all secret)*
3. **Generate Domain** (public HTTPS). Railway injects `PORT`; the shim binds it.

> Do **not** commit any of: `ROUTER_PRIVATE_KEY`, `UPSTREAM_API_KEY`, model
> provider keys, `PRIVATE_KEY` / `AGENT_*_PRIVATE_KEY`, `SESSION_SECRET`,
> `CRYPTO_SECRET`. They are Railway Variables only.

### DoD check — external client (OpenAI *or* Anthropic)

Once both services are up, the shim URL is a drop-in `base_url` for both dialects.

OpenAI:

```bash
curl -s https://<shim-domain>/v1/chat/completions \
  -H "Authorization: Bearer boa-sk-agent-a" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-opus-4-6","messages":[{"role":"user","content":"hello"}]}'
```

Anthropic:

```bash
curl -s https://<shim-domain>/v1/messages \
  -H "x-api-key: boa-sk-agent-a" -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-opus-4-6","max_tokens":64,"messages":[{"role":"user","content":"hello"}]}'
```

or from the SDKs:

```python
from openai import OpenAI
OpenAI(base_url="https://<shim-domain>/v1", api_key="boa-sk-agent-a") \
    .chat.completions.create(model="claude-opus-4-6",
        messages=[{"role": "user", "content": "hello"}])

from anthropic import Anthropic
Anthropic(base_url="https://<shim-domain>", api_key="boa-sk-agent-a") \
    .messages.create(model="claude-opus-4-6", max_tokens=64,
        messages=[{"role": "user", "content": "hello"}])
```

Each returns the provider-shaped response plus the `x-boa-usage` header (signed
receipt). *(Both verified live on Railway against `claude-opus-4-6` via new-api.)*
With `UPSTREAM_*` set, the body is a real model response from new-api; unset, it
is the stub echo. *(Verified locally: the container image builds, boots, and serves
this exact call with HTTP 200 + a signed `x-boa-usage` receipt.)*

## Layout

```
relay/
  Dockerfile          production image (Node 22, no build step)
  railway.json        Railway build/deploy + /health healthcheck
  index.ts            entry — `node relay` / `npm start`
  demo.ts             full closed-loop demo — `npm run demo`
  src/
    config.ts         env + market config (reads ../contracts/deployments.json)
    types.ts          shared types + rail interfaces
    identity.ts       STUB identity rail (static ENS map)
    settlement.ts     STUB settlement rail (mock USDC)
    proof.ts          STUB proof rail (router-signed receipts → JSONL)
    metering.ts       token estimate + USDC pricing
    upstream.ts       stub echo model / OpenAI-compatible forward
    membership.ts     voucher + quota ledger over the chain adapter
    server.ts         express routes (interface contract v0)
    chain/
      memory.ts       in-memory FOAMM (default)
      onchain.ts      Base Sepolia ERC-7527 via viem (optional)
      index.ts        adapter factory
```
