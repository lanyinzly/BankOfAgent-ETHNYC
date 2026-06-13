# Hedera HCS proof-rail spike — Bank of Agent (Sprint 0)

**Gate question:** can BoA's *proof rail* run? i.e. create a topic on Hedera HCS,
submit one message, and read that same message back from the mirror node.

**What we actually submit is not a log line — it's a router-signed usage receipt.**
HCS doesn't prove "real consumption"; it proves *a signed claim of consumption that
can't be tampered with*. So BoA turns every agent call into a signed, immutable
receipt and writes that to the rail. This is the on-chain twin of the
"verifiable delivery / usage digest synced to ENS" pillar in the
[root README](../../README.md).

```
agent call ──▶ router builds UsageReceipt ──▶ router signs it (secp256k1 / EIP-191)
            ──▶ submit to HCS topic ──▶ mirror node REST read-back ──▶ verify identical + signature
```

Receipt schema (the exact HCS message body):

```jsonc
{
  "request_id":          "req_…",
  "agent_ens":           "agent-a.boa.eth",
  "membership_token_id": "7527",
  "model":               "openai/gpt-4o-2024-08-06",
  "input_tokens":        1843,
  "output_tokens":       512,
  "total_cost_usdc":     "0.004212",
  "settlement_tx":       "0x…",          // Arc / USDC settlement
  "price_before":        "1.0000",       // FOAMM premium before the call
  "price_after":         "1.0007",       // FOAMM premium after the call
  "router_signature":    "0x…"           // EIP-191 sig over canonical(receipt − this field)
}
```

`router_signature` is a real signature over the canonical (sorted-key, whitespace-free)
JSON of every field except the signature itself. Anyone can recover the router's
address from it with `ecrecover` — no secret needed to verify.

---

## TL;DR verdict

| Rail | What it proves | Status |
|------|----------------|--------|
| **Mirror-node READ** (`npm run verify-read`) | read + base64-decode a real HCS message off live testnet | ✅ **PASS** (live, no creds) |
| **Fallback digest rail** (`npm run fallback`) | same router-signed receipt → sha-256 digest → local DB → verify | ✅ **PASS** (live, no creds) |
| **Full HCS write+read** (`npm run spike`) | create topic → submit signed receipt → read back identical | ⏳ **READY — blocked on a funded testnet account** |

**Go/no-go: GO, conditional on one human step.** The read half of the rail is proven
live *right now*, the receipt/sign/digest logic is proven green, and `npm run spike`
typechecks clean against the current `@hashgraph/sdk` (2.81.x) API. The single missing
piece is a funded testnet **operator account**, which can't be self-served here because
the only no-login faucet is **reCAPTCHA-gated** (see "Account source"). Drop credentials
into `.env` and the one-command round-trip completes. This is a provisioning gate, not a
code or API failure.

---

## Account source (researched 2026-06-13, not from memory)

You need a funded Hedera **testnet** account to create topics / submit messages
(reads need nothing). Two ways:

1. **Portal (recommended):** <https://portal.hedera.com> → sign in → create a testnet
   account → copy the **Account ID** (`0.0.x`) and the **DER-encoded private key**.
   Default key type is **ED25519**; you can also create ECDSA. Portal accounts can be
   topped up to ~1,000 testnet HBAR / 24h.
2. **No-login faucet:** <https://portal.hedera.com/faucet> → paste an account id / EVM
   address → up to **100 testnet HBAR / 24h**. ⚠️ This page is **reCAPTCHA-gated**, so it
   can't be driven headlessly from a script — it needs a human in a browser. That's why
   this spike can't mint its own account autonomously.

> Testnet is **reset periodically** — accounts and topics are wiped. If `spike` fails
> with an account/key error after a reset, re-fund and refresh `.env`.

Put the credentials in `.env` (git-ignored). **Never commit `.env`.**

```bash
cp .env.example .env
# edit .env: HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, HEDERA_OPERATOR_KEY_TYPE
```

---

## How to run

```bash
cd spikes/hedera
npm install

npm run verify-read   # live mirror-node READ rail — no creds needed
npm run fallback      # local signed-digest rail — no creds needed
npm run spike         # full create→submit→read round-trip — needs .env creds
npm run typecheck     # tsc --noEmit over everything
```

- **Mirror node endpoint:** `https://testnet.mirrornode.hedera.com`
  - all messages: `/api/v1/topics/{topicId}/messages`
  - one message:  `/api/v1/topics/{topicId}/messages/{sequenceNumber}`
  - message bodies are **base64**; the scripts decode them.
- **Router key:** `ROUTER_PRIVATE_KEY` in `.env` (any secp256k1 key). If unset, an
  **ephemeral** key is generated per run and its address printed — the signature is
  still real, just not stable across runs.

---

## Evidence captured on this run (2026-06-13)

### ✅ `npm run verify-read` — read rail is live on testnet

```
=== verify mirror-node READ rail (live testnet, no credentials needed) ===
mirror node: https://testnet.mirrornode.hedera.com
found a live topic with a recent message: 0.0.7399331
topic_id: 0.0.7399331  sequence_number: 4950314  consensus_timestamp: 1781381359.899157627
message read back + base64-decoded OK: 263 bytes
PASS ✅  mirror-node read + base64-decode rail is live on testnet.
```

### ✅ `npm run fallback` — signed-receipt + digest rail

```
=== BoA fallback proof rail (local signed-digest receipt) ===
router signer address: 0xFb20Edc8A0Dad456777a42C97397FF57b4fE3341
[write] appended receipt to .../data/receipts.json (now 1 record(s))
[write] digest (immutability anchor → would be written to agent ENS text record):
        0x6bafa1726b53d3c62739e533a61a706e936119befa893d3ac2e2d260acc1e146
[read] re-read last record from DB: { ...full router-signed receipt... }
=== RESULT ===
digest recompute: MATCH (0x6bafa1726b53d3c62739e533a61a706e936119befa893d3ac2e2d260acc1e146)
router signature: VALID (recovered 0xFb20Edc8A0Dad456777a42C97397FF57b4fE3341)
PASS ✅  fallback rail works: router-signed receipt + sha-256 digest persisted and verified locally.
```

### ⏳ `npm run spike` — blocked cleanly on missing creds (exit 2)

```
[blocked] Missing/placeholder HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY.
  → Get a funded testnet account from https://portal.hedera.com (or the no-login
    faucet https://portal.hedera.com/faucet), then: cp .env.example .env, fill it in,
    and re-run `npm run spike`.
```

**To complete the gate:** after `.env` is filled, `npm run spike` prints `topicId`,
the consensus `sequenceNumber`, the decoded JSON read back from the mirror node, a
`bytes round-trip: MATCH`, `router signature: VALID`, a HashScan link, and a final
`PASS ✅`. **Paste the real `topicId` + `sequenceNumber` from that run here:**

```
topicId:        0.0.__________   (PENDING — fill after a credentialed run)
sequenceNumber: __________
hashscan:       https://hashscan.io/testnet/topic/0.0.__________
```

---

## Fallback talk track (for the demo)

> "Our proof rail is **HCS** — every agent call becomes a router-signed, immutable
> usage receipt on the Hedera Consensus Service. If HCS is ever unreachable, the
> retreat is to write the receipt's **sha-256 digest** to a local DB and to the agent's
> **ENS** text record. HCS stays the *planned* proof rail; the digest-to-ENS path is the
> degraded mode that keeps delivery verifiable."

The fallback (`npm run fallback`) uses the **identical** receipt + signing path as the
HCS rail, so the only thing that changes between the two is *where* the immutable anchor
lives (HCS sequence number vs. sha-256 digest in DB/ENS).

---

## Files

```
spikes/hedera/
├── src/
│   ├── receipt.ts          # UsageReceipt schema, canonical JSON, sign / verify / digest
│   ├── hcs-spike.ts        # create topic → submit signed receipt → mirror-node read-back → verify
│   ├── fallback.ts         # same receipt → sha-256 digest → local JSON DB → verify (HCS-down retreat)
│   └── verify-read-rail.ts # prove live mirror-node read+decode without an operator account
├── .env.example            # copy to .env (git-ignored) and fill in
├── package.json            # @hashgraph/sdk, ethers, dotenv, tsx, typescript
└── tsconfig.json
```

**Scope discipline:** this spike only proves "submit one message and read it back".
No relay, no frontend, no contracts. Secrets live in `.env` and are git-ignored.
