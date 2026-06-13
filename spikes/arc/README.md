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
| **Funded 1-USDC transfer on Arc — on-chain `A↓ / B↑` + tx hash** | **PASS** ✅ (executed live 2026-06-13, see below) |

### Actual run — Arc Testnet (2026-06-13)

```
$ npm run arc
================ Arc Testnet ================
chainId:   5042002 (expected 5042002) ✓
USDC:      0x3600000000000000000000000000000000000000  (USDC, 6 decimals)
Wallet A (sender):    0xd1EDb3Cd774C427e1A5045a7365873ed42f86791
Wallet B (recipient): 0xc6C30Aee87B96b5B2fC85125c7cE25565873608D

----- balances BEFORE -----
A: 20.0 USDC
B: 0.0 USDC

Sending 1 USDC: A -> B ...
tx hash:  0x46d80dbe0a3cfb22260adb6679e395b13cfad84405f537818ba40f214935ef68
mined:    block 46925940, status=success ✓

----- balances AFTER -----
A: 18.99852 USDC  (delta -1.00148)
B: 1.0 USDC  (delta +1.0)

RESULT: PASS ✅ — 1 USDC moved A -> B (A decreased, B increased)
```

- **tx:** https://testnet.arcscan.app/tx/0x46d80dbe0a3cfb22260adb6679e395b13cfad84405f537818ba40f214935ef68
- **Independently confirmed via raw RPC** (not the script): `balanceOf(B)` = `0xf4240` =
  `1000000` = **1.0 USDC**; receipt `status` = `0x1` (success), block `46925940`.
- **Note A's delta is `-1.00148`, not `-1.0`:** the extra `0.00148` is the **gas, paid in
  USDC**. That single-asset property is exactly what makes Arc ideal for nanopayments —
  a payment carries its own gas, no separate ETH needed.

### Fallback (Base Sepolia) — not needed this run
Arc passed, so the fallback wasn't executed live. The script is identical (`npm run
base`) and verified reachable: RPC up, chainId `84532`, USDC contract reads confirmed.
To run it, fund wallet A with both test USDC **and** test ETH (gas). Status: **READY**
(drop-in if Arc is down).

### Go / no-go verdict
**GO ✅.** The Arc settlement rail is proven: 1 USDC moved A→B on-chain with a confirmed
tx hash and verified `A↓ / B↑` balance change, gas paid in USDC. The Base Sepolia
fallback is ready as a drop-in (standard USDC ERC-20 `transfer`) if Arc is ever
unavailable.

---

# Agentic demo — Circle Programmable Wallets + CCTP V2 + x402

A second spike (`src/agentic/`) wires the full agent-payments loop:

1. **Circle Programmable Wallets** give each agent a wallet.
2. **CCTP V2** bridges USDC from another chain **into Arc** (burn → attest → mint).
3. **x402** lets an agent **pay the relay per usage**, settled on Arc.

```bash
npm run agentic        # runs all three legs, one command
# extras:
npm run cctp           # just the CCTP V2 bridge step (simulate; CCTP_LIVE=1 to execute)
npm run agent-wallets  # just provision agent wallets
```

### Real vs simulated (honest split)
| Leg | Mode in this run | How to make it live |
| --- | --- | --- |
| **1. Programmable Wallets** | **SIMULATE** — local ethers wallets stand in for Circle PW (reuses the funded `.env` A/B) | set `CIRCLE_API_KEY` + `CIRCLE_ENTITY_SECRET`; code calls `@circle-fin/developer-controlled-wallets` → `createWalletSet` → `createWallets({blockchains:["ARC-TESTNET"]})` |
| **2. CCTP V2 bridge** | **SIMULATE** — prints the exact real calls (real contracts/domains) | set `CCTP_LIVE=1` + a funded Base Sepolia sender (USDC + test ETH for gas); code runs `approve → depositForBurn → poll Iris → receiveMessage` |
| **3. x402 pay-per-usage** | **REAL on-chain on Arc** ✅ | already live — each call settles a USDC transfer on Arc |

> Why 1 & 2 are simulated: no Circle API key and no funded source-chain USDC are
> available to an unattended agent here. The code paths are real and gated, not faked —
> flip the env vars/funds and they execute. The x402 leg runs for real because the
> agent's faucet USDC is already on Arc.

### CCTP V2 facts used (testnet, verified 2026-06-13)
- TokenMessengerV2: `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`
- MessageTransmitterV2: `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`
- Attestation (Iris sandbox): `https://iris-api-sandbox.circle.com/v2/messages/{srcDomain}?transactionHash=…`
- Domains: Ethereum Sepolia `0`, Avalanche Fuji `1`, **Base Sepolia `6`**, **Arc `26`**
- `depositForBurn(amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee, minFinalityThreshold)` — `minFinalityThreshold=2000` standard / `1000` fast.

### x402 note
This demo uses the x402 **shape** (`402` → `accepts` → `X-PAYMENT` → on-chain verify),
settling via a direct USDC transfer on Arc that the relay verifies from the receipt. The
canonical x402 EVM *exact* scheme instead settles via **EIP-3009 `transferWithAuthorization`**
through a facilitator (gasless for the payer). That's the production upgrade path; the
HTTP/verification flow here is identical.

### Actual run — `npm run agentic` (2026-06-13)
x402 leg, **live on Arc** — relay billed per requested usage:

| Call | maxTokens | Paid (USDC) | Settlement tx |
| --- | --- | --- | --- |
| 1 | 256 | 0.00512 | `0x4d3879e3a9cb46bac4b6e833bee0435e4374e8416893587abf830c6f8bde42d3` |
| 2 | 512 | 0.01024 | `0x79de2b53f80828e01052df2ad2a7fbf4ec0d6543b5d4805955e4335b13a1f363` |
| 3 | 1024 | 0.02048 | `0x9f551c4a6c5727df1e38262ac22c5ec9d2e707eddc57c95cd459db66226fb6c6` |

- relay balance: `1.0 → 1.03584 USDC` (delta **+0.03584** = total usage billed).
- agent balance: `18.99852 → 18.959743 USDC` (delta **−0.038777** = usage `0.03584` + gas, both in USDC).
- **Independently confirmed via raw RPC:** relay `balanceOf` = `1035840` (1.03584 USDC); call-1 receipt `status` = `1`.
- **RESULT: PASS ✅** — relay paid per-usage via x402, settled on Arc.

This is the BoA loop in miniature: an agent funds on Arc (via CCTP), holds a (Circle PW)
wallet, and **pays a metered service per call in USDC on Arc** — i.e. the "spot price /
live per-call metering" primitive, settled on the rail this spike proved.
