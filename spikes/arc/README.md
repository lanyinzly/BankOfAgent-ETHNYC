# Spike: Arc settlement rail (Sprint 0 go/no-go gate)

**Goal (the only goal):** prove the settlement rail can move money — send **1 test USDC
from wallet A to wallet B on Arc testnet** and confirm it landed. This is a go/no-go
spike, not a product feature. No relay, no frontend, no contracts touched.

> **Positioning / talking point:** nanopayments settle on **Arc** (USDC is the native
> gas token, so a payment needs only one asset). The **fallback**, if Arc is down, is a
> **standard USDC ERC-20 `transfer` on Base Sepolia** — same script, same ABI, different
> chain.

---

## Network facts (verified live on 2026-06-13)

All values below were confirmed against the live RPCs from this repo (`eth_chainId`,
plus `decimals()` / `symbol()` on each USDC contract).

### Primary rail — Arc Testnet
| Field | Value |
| --- | --- |
| RPC URL | `https://rpc.testnet.arc.network` |
| Chain ID | `5042002` (hex `0x4cef52`) — **verified** |
| USDC (ERC-20 interface) | `0x3600000000000000000000000000000000000000` |
| USDC decimals | `6` — **verified** (`symbol()` → `USDC`) |
| Gas token | **USDC** (Arc uses USDC as its native gas token — no ETH needed) |
| Explorer | https://testnet.arcscan.app |
| Faucet | https://faucet.circle.com → select **Arc Testnet** (20 USDC / 2h / address) |

> Arc note: USDC is the chain's *native* asset (18-decimal native balance) **and** is
> exposed through an ERC-20 interface at `0x3600…0000` (6 decimals). This spike uses the
> ERC-20 `transfer` path so it is identical to the Base Sepolia fallback. Because gas is
> paid in USDC, funding wallet A from the faucet covers **both** the payment and its gas.

### Fallback rail — Base Sepolia
| Field | Value |
| --- | --- |
| RPC URL | `https://sepolia.base.org` |
| Chain ID | `84532` (hex `0x14a34`) — **verified** |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| USDC decimals | `6` — **verified** (`symbol()` → `USDC`) |
| Gas token | **ETH** (wallet A also needs test ETH for gas) |
| Explorer | https://base-sepolia.blockscout.com |
| USDC faucet | https://faucet.circle.com → select **Base Sepolia** |
| Gas (ETH) faucet | https://www.alchemy.com/faucets/base-sepolia |

---

## How to run

```bash
cd spikes/arc
npm install

# 1. Create two fresh testnet wallets (writes a gitignored .env):
npm run gen

# 2. Fund wallet A with test USDC at the faucet above (paste the printed A address).
#    - Arc:  faucet.circle.com → Arc Testnet  (covers gas too)
#    - Base: faucet.circle.com → Base Sepolia  + Alchemy faucet for ETH gas

# 3. Move 1 USDC, A -> B:
npm run arc      # primary rail (Arc)
npm run base     # fallback rail (Base Sepolia)
```

Each run prints: network + chainId check, the USDC contract it's using, **balances
BEFORE**, the **tx hash** (+ explorer link), the mined receipt status, **balances
AFTER** with deltas, and a `PASS`/`FAIL` verdict. One command does the whole thing.

### Secrets
- Private keys live only in `.env`, which is **gitignored** (`.gitignore` excludes
  `.env` / `.env.*` but keeps `.env.example`). `npm run gen` writes `.env` with mode
  `600`. **No private key or mnemonic is ever committed.** `.env.example` holds
  placeholders only.

---

## Result — PASS / FAIL

| Check | Status |
| --- | --- |
| Arc RPC reachable, chainId `5042002` | **PASS** (verified live) |
| Arc USDC contract reads (`symbol`/`decimals`/`balanceOf`) | **PASS** (verified live) |
| Base Sepolia RPC reachable, chainId `84532` | **PASS** (verified live) |
| Base Sepolia USDC contract reads | **PASS** (verified live) |
| One-command transfer script (connect → read → send → verify) | **PASS** — runs end-to-end; on an unfunded wallet it correctly reports `BLOCKED` and prints the faucet + address |
| **Funded 1-USDC transfer with on-chain `A↓ / B↑` + tx hash** | **PENDING FUNDING** — see below |

**Why PENDING and not done in this run:** the actual send needs wallet A funded, and
Circle's faucet is gated behind either a **reCAPTCHA web step** (human) or the
**`POST /v1/faucet/drips` API** (needs a Circle API key). Neither is available to an
unattended agent in this environment, so no real drip could be performed here. The
transfer path itself is fully wired and verified up to that point.

**One step to flip this to full green:**
1. Open https://faucet.circle.com, select **Arc Testnet**, paste wallet A's address
   (printed by `npm run gen`), request 20 USDC.
2. Run `npm run arc`. It will print the tx hash and `A↓ / B↑`.

### Go / no-go verdict
**GO (pending a single faucet drip).** The Arc settlement rail is **reachable and the
USDC transfer path is fully implemented and verified** end-to-end except for the
faucet-gated funding step. The Base Sepolia fallback is equally ready as a drop-in if
Arc is unavailable. Nothing structural blocks moving USDC on Arc.
