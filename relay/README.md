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

> **This contract is frozen. The web demo session must match it exactly.**
> All FOAMM premium/price values are decimal strings denominated in **ETH** (the
> market currency on Base Sepolia); per-call usage cost is denominated in **USDC**.

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

## Usage receipt schema (FROZEN)

Every metered call produces exactly this object. `router_signature` is a real
ECDSA signature by the relay's router key over the stable-sorted JSON of the
other fields — so *every call == one signed usage receipt*, ready to publish to
Hedera HCS later without changing shape.

```jsonc
{
  "request_id":          "boa-req-…",
  "agent_ens":           "agent-a.boa.eth",
  "membership_token_id": 1,            // or null when paid from standalone quota
  "model":               "boa-stub-echo",
  "input_tokens":        15,
  "output_tokens":       58,
  "total_cost_usdc":     0.000095,
  "settlement_tx":       "0x…",        // mock USDC settlement reference (Arc later)
  "price_before":        "0.0000202",  // FOAMM membership premium (ETH) at call time
  "price_after":         "0.0000202",  // a call does not move the curve, so == before
  "router_signature":    "0x…"         // ECDSA over the stable-sorted receipt body
}
```

---

## Quota / membership model

Reconciles the on-chain ERC-7527 mechanics (`wrap` / `unwrap`) with the
"redeem the voucher into quota" narrative. **The web demo must align with this.**

- **Buy (`wrap`)** mints an ERC-7527 voucher to the agent **and** attaches a
  metered usage allowance (`BOA_QUOTA_USDC`, default `5` USDC) to that token.
- An agent may call models while it has available quota:
  `availableQuota(agent) = Σ allowance(vouchers it owns) + standaloneQuota(agent)`.
  Each call deducts its `total_cost_usdc` (voucher allowances first, then standalone).
- **Transfer** moves the voucher **and its remaining allowance** to the new owner.
- **Redeem (`unwrap`)** burns the voucher, returns the FOAMM premium on-chain, and
  converts the voucher's remaining allowance into **standalone quota** for the
  redeemer — so the second agent keeps callable quota after redeeming (the demo's
  closing step).

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

## Layout

```
relay/
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
