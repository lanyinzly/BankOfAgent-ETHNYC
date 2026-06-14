# Live demo runbook — BoA on Hedera (HCS proof rail)

A 2–3 minute live demo showing **Bank of Agent using Hedera** in front of judges.
Everything here is real and on **Hedera testnet**.

---

## 30-second pitch (say this first)

> "AI compute today is metered inside a provider's private database — nobody else can
> audit what an agent actually used. Bank of Agent fixes that: **every agent call becomes
> a usage receipt, signed by our router, and written to the Hedera Consensus Service.**
> HCS gives it a consensus timestamp and an immutable, ordered place on a public ledger.
> So an agent's consumption becomes a **verifiable, tamper-evident audit trail** that
> anyone can read back and check — not a log you have to trust us on. Let me show you a
> receipt go on-chain, live."

---

## What actually happens (the process, in 5 steps)

```
1. METER   an agent call → build a UsageReceipt
           { request_id, agent_ens, membership_token_id, model,
             input_tokens, output_tokens, total_cost_usdc,
             settlement_tx, price_before, price_after }

2. SIGN    BoA's router signs the receipt (secp256k1 / EIP-191).
           → tamper-evident; anyone can ecrecover the router's address.

3. CREATE  open an HCS topic (TopicCreateTransaction), gated with
           admin + submit keys so only BoA's key can append receipts.

4. SUBMIT  publish the signed receipt as an HCS message
           (TopicMessageSubmitTransaction). Hedera consensus assigns a
           sequence number + consensus timestamp → immutable, ordered.

5. VERIFY  read it back from the Hedera mirror-node REST API,
           base64-decode, confirm it's byte-identical and the router
           signature still recovers → PASS.
```

Transport note for the technically-minded judge: submission goes to Hedera **consensus
nodes over gRPC**; read-back uses the **mirror-node REST API over HTTPS**. The receipt is
the Hedera-native twin of BoA's "verifiable delivery" pillar.

---

## Pre-flight checklist (do this BEFORE you present)

1. **Be on a normal network** (laptop / venue wifi), not a restricted sandbox — consensus
   submission needs gRPC ports 50211/50212 open. Quick check:
   ```bash
   node -e 'const n=require("net"),s=new n.Socket();s.setTimeout(5000);s.once("connect",()=>{console.log("gRPC OPEN ✅");s.destroy()});s.once("timeout",()=>console.log("BLOCKED ❌"));s.once("error",e=>console.log("ERR",e.code));s.connect(50211,"0.testnet.hedera.com")'
   ```
2. **Funds:** the operator account `0.0.9186016` needs testnet HBAR. Testnet resets
   periodically — top up at <https://portal.hedera.com/faucet> (or re-create an account
   and update `.env`). A topic-create + message-submit costs a fraction of 1 HBAR.
3. **`.env` is present** in `spikes/hedera/` (git-ignored). It holds the operator creds
   and a stable router key. Demo router address: `0xe8B116512754f20256b0e9a6f0cA8ADb077c96E9`.
4. **Dependencies installed:** `cd spikes/hedera && npm install` once, ahead of time.
5. **Do one dry run** right before going on stage and keep that HashScan tab as a backup.

---

## The live demo (what to type, what to say, what to show)

### Beat 1 — run it (terminal)

```bash
cd spikes/hedera
npm run spike
```

Narrate as the output scrolls:

- **"Here's the usage receipt for an agent call…"** — point at the JSON (`agent_ens`,
  `total_cost_usdc`, the FOAMM `price_before`/`price_after`).
- **"…and BoA's router just signed it."** — point at `router_signature` and the line
  `recovered signer … 0xe8B1…96E9` → *"anyone can verify that signature, no secret needed."*
- **"Now it goes on-chain."** — point at `created topic: 0.0.x` and
  `submitted receipt → consensus sequence number: 1`.
- **"And we read it straight back off Hedera's mirror node — byte-identical."** — point at
  `bytes round-trip: MATCH`, `router signature: VALID`, and the final `PASS ✅`.

### Beat 2 — prove it's real (browser) — the money shot

Open the **HashScan** link the script printed, e.g.:

```
https://hashscan.io/testnet/topic/<the-new-topicId>
```

Show the judges: the topic, the message, the **consensus timestamp**, the running hash.
*"This is a public block explorer — this receipt is now permanently on Hedera testnet."*

### Beat 3 (optional) — raw ledger read

Paste the mirror-node REST URL into the browser to show the raw on-chain message:

```
https://testnet.mirrornode.hedera.com/api/v1/topics/<topicId>/messages/1
```

*"The `message` field is base64 — decode it and it's the exact signed receipt we
submitted. No private database in the loop."*

---

## If the live run fails (backup plan)

- **Network blocked / on stage wifi is locked down:** show the dry-run HashScan tab you
  opened during pre-flight, plus a previously-created topic, e.g.
  <https://hashscan.io/testnet/topic/0.0.9227495>. The artifact is permanent.
- **Testnet reset / out of HBAR:** re-fund at the faucet, or fall back to
  `npm run fallback` — same signed receipt, anchored by a sha-256 digest locally
  (talk track: *"HCS is our proof rail; if it's ever down we anchor the digest to the
  agent's ENS record — still verifiable"*).
- **Read lag:** the mirror node can take a few seconds; the script already polls/retries.

---

## How this maps to the Hedera prize

- **Verifiable payment audit trails using HCS** — each receipt is a signed, immutable,
  consensus-timestamped HCS message. ✅ (core of this demo)
- **Financial operation on testnet** — the receipt carries `total_cost_usdc` and a
  `settlement_tx`; the write itself is a paid, on-chain Hedera transaction. ✅
- **HTS / custom fees / agent identity (HCS-14), x402, A2A** — natural next steps that
  build on this same rail (see the root README roadmap).

---

## One-liner cheatsheet

```bash
cd spikes/hedera
npm run spike        # the demo: create topic → submit signed receipt → read back → PASS
npm run verify-read  # backup: prove the mirror-node read rail live (no creds)
npm run fallback     # backup: signed receipt → sha-256 digest → local DB (HCS-down retreat)
```

Last verified live: **2026-06-14**, topic `0.0.9227461` / `0.0.9227495`, seq `1`, PASS.
