# Demo runbook — showing the Arc settlement rail (for Circle/Arc folks)

A ~4‑minute live demo. Two beats: **(1) the rail moves USDC on Arc**, then **(2) an
agent pays a metered service per call in USDC on Arc** — the BoA product loop in
miniature.

## Before you go on stage (pre-flight)
```bash
cd spikes/arc
npm install          # first time only
npm run preflight    # checks RPCs are up + wallet A is funded, prints explorer links
```
- If preflight says **NOT READY**, fund wallet A: https://faucet.circle.com → **Arc Testnet**
  → paste A's address (preflight prints it) → request 20 USDC.
- Open the two explorer links preflight prints (wallet A and B on `testnet.arcscan.app`)
  in browser tabs — you'll refresh them live.
- Re-run economics: each `npm run arc` moves a full **1 USDC** (A funds ~N runs where
  N = A's balance); each `npm run agentic` spends **~0.039 USDC**. Top up anytime.

## The script

### Beat 1 — "the rail settles" (60s)
```bash
npm run arc
```
Say: *"Fresh wallet A → wallet B, 1 USDC, on Arc testnet. Watch the balances and the tx
hash."* Point at:
- `chainId 5042002 ✓`, USDC `0x3600…0000`, **6 decimals**.
- Balances **BEFORE → AFTER**: A `−1.00148`, B `+1.0`.
- **The −1.00148, not −1.0** → *"gas is paid in USDC — the payment carried its own gas,
  no ETH anywhere."* This is the line Arc folks care about.
- Open the printed `testnet.arcscan.app/tx/…` link → show it finalized in one block.

### Beat 2 — "an agent pays per usage" (90s)
```bash
npm run agentic
```
Say: *"Now the product: an agent with a wallet calls a metered relay. The relay answers
**HTTP 402** with a price scaled by usage; the agent pays USDC on Arc and retries with
proof; the relay verifies on‑chain and serves the result. That's x402."* Point at:
- 3 calls, **256 / 512 / 1024 tokens → 0.00512 / 0.01024 / 0.02048 USDC** (price scales
  with usage).
- Relay balance **+0.03584** = exactly the total billed; agent **−0.038777** (usage +
  gas, both USDC).
- `RESULT: PASS ✅`. Open one settlement tx on arcscan.

### One‑liner (does both, with preflight)
```bash
npm run demo
```

## What's real vs simulated (say this — it builds trust)
- **REAL on Arc:** the 1‑USDC settlement (Beat 1) and **all x402 pay‑per‑usage**
  settlements (Beat 2). Real tx hashes, on arcscan.
- **Simulated (gated, real code):** the **CCTP V2 bridge** (Base Sepolia domain 6 → Arc
  domain 26) and **Circle Programmable Wallets** provisioning — only because this machine
  has no Circle API key / no funded source‑chain USDC. Flip `CCTP_LIVE=1` (+ funded
  sender) or set `CIRCLE_API_KEY`+`CIRCLE_ENTITY_SECRET` and they execute. See `README.md`.

## Turn it into a conversation — what to ask Arc for
- A **funded testnet wallet / faucet bump** so we run the **CCTP V2 bridge live** on stage
  (we already have the exact `depositForBurn → Iris → receiveMessage` flow coded).
- Whether there's an **x402 facilitator on Arc** (and EIP‑3009 support on the `0x3600`
  USDC) so payments become **gasless** for the payer — our documented upgrade path.
- **Circle Programmable Wallets** access for agent custody at scale (`ARC-TESTNET` is
  supported).

## If something breaks on stage
- **Arc RPC hiccup:** run the fallback `npm run base` (standard USDC ERC‑20 transfer on
  Base Sepolia) — same script, proves the rail is chain‑portable. (Needs A funded with
  test USDC **and** a little test ETH for gas there.)
- **No network at all:** the `README.md` has the recorded PASS output + permanent arcscan
  tx links — show those.

## The narrative hook (tie to BoA)
*"Inference becomes a commodity when it has a unit of account, a spot price, and
verifiable delivery. Arc gives us the unit of account (USDC) and the rail; x402 gives us
the live per‑call spot price; settlement is final in <1s with gas in USDC. What you just
saw is that loop running for real."*
