# Bank of Agent (BoA) — the settlement rail for the agent economy, on Arc

**One line:** BoA turns AI inference into a tradable commodity. **Arc is the settlement
rail** that makes agent‑speed, stablecoin‑native payments real — and we proved it on‑chain.

---

## The problem
Compute is sold like a SaaS subscription: pay‑per‑call, balances trapped in one provider,
no way to price, hedge, or resell the right to use a model. Autonomous agents need to
**pay for compute at machine speed and micro size** — and no ordinary chain settles a
half‑cent payment *instantly, in a stable unit, without juggling a separate gas token*.

## What we built — real, on Arc testnet
- **Settlement proven.** Moved real USDC wallet→wallet on Arc, finalized in one block,
  verified on arcscan.
- **Agent pay‑per‑use loop.** An AI agent pays a metered service **per API call, in USDC,
  settled on Arc** via the **x402** protocol — real on‑chain payments scaled to usage.
- **On‑ramp + custody (coded, gated).** **CCTP V2** bridges USDC into Arc; **Circle
  Programmable Wallets** give each agent a wallet.

## Why Arc — the significance
- **Gas is USDC.** An agent holds **one asset**; a $0.005 payment carries its own gas. No
  ETH to manage — the exact friction that breaks autonomous agents on other chains.
- **Deterministic sub‑second finality.** The payment is **final before the API responds** —
  no confirmations, no reorg risk. Half‑cent inference calls become economically real.
- **USDC = unit of account.** Stable pricing; sub‑cent economics survive token volatility.
- **EVM + Circle stack** (CCTP, Gateway, x402, Wallets) → liquidity in from any chain,
  managed agent wallets out.

## Live proof (not a mock)
- **Settlement:** tx `0x46d80dbe…35ef68` — A `−1.00148` (1 USDC **+ gas, in USDC**), B `+1.0`.
- **x402 pay‑per‑use:** 3 calls billed `0.00512 / 0.01024 / 0.02048` USDC; relay credited
  **exactly the total**. Independently re‑verified via raw RPC.
- **One command:** `npm run demo`. Explorer: `https://testnet.arcscan.app`.

## What's next
- **Gasless payments** via EIP‑3009 `transferWithAuthorization` (x402 facilitator on Arc).
- **Live CCTP V2** bridge (Base Sepolia → Arc) for cross‑chain agent funding.
- **ERC‑7527 voucher** = a transferable claim on *future* compute → BoA's forward curve.

---
*Built at ETHGlobal NY · Settlement on Arc + USDC.*
