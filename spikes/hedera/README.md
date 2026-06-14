# Hedera HCS proof-rail spike — Bank of Agent (Sprint 0)

**Gate question:** can BoA's *proof rail* run? i.e. create a topic on Hedera HCS,
submit one message, and read that same message back from the mirror node.

**What we submit is not a log line — it's a router-signed usage receipt.**
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

## TL;DR verdict — **GO (PASS, verified live end-to-end)**

The full create→submit→read round-trip **passed live on Hedera testnet** on 2026-06-14:
a router-signed usage receipt was written to HCS and read back byte-identical from the
mirror node. The receipt/sign/verify logic, the mirror-node read rail, and the fallback
rail are all proven green.

| Rail | What it proves | Status |
|------|----------------|--------|
| **Mirror-node READ** (`npm run verify-read`) | read + base64-decode a real HCS message off live testnet | ✅ **PASS** (live, no creds) |
| **Receipt sign + verify** (inside `spike`) | router signs the receipt; signature recovers the router address | ✅ **PASS** (live) |
| **Fallback digest rail** (`npm run fallback`) | same signed receipt → sha-256 digest → local DB → verify | ✅ **PASS** (live, no creds) |
| **Full HCS write+read** (`npm run spike`) | create topic → submit signed receipt → read back identical | ✅ **PASS** — topic [`0.0.9227461`](https://hashscan.io/testnet/topic/0.0.9227461) seq `1` (2026-06-14) |

**Live result:** operator `0.0.9186016` → topic
[`0.0.9227461`](https://hashscan.io/testnet/topic/0.0.9227461), sequence number `1`,
consensus `1781397188.243630630`, `bytes round-trip: MATCH`, `router signature: VALID`.

> **One operational note:** `npm run spike` must run from a host with open **gRPC**
> egress (a normal laptop / terminal). It cannot run *inside* the Claude-Code-web
> sandbox, which only permits HTTPS/443 while Hedera consensus nodes need gRPC
> 50211/50212 — see "The sandbox egress blocker". The PASS above was produced from a
> teleported local terminal; reads (`verify-read`) and the fallback run anywhere.

---

## The sandbox egress blocker (the reason the live write didn't run here)

Claude-Code-web environments route all outbound traffic through an HTTP/HTTPS security
proxy and only allow **port 443**. Measured from inside this container (2026-06-13):

```
0.testnet.hedera.com:50211         -> TIMEOUT/blocked   (consensus gRPC, plaintext)
0.testnet.hedera.com:50212         -> TIMEOUT/blocked   (consensus gRPC, TLS)
testnet.mirrornode.hedera.com:443  -> OPEN              (mirror node REST — reads work)
```

The Hedera SDK submits transactions to **consensus nodes over gRPC (50211/50212)**;
there is no HTTPS/REST endpoint for submitting a `TopicCreateTransaction`. So topic
creation/message submission can't run from any web sandbox, while mirror-node reads
(HTTPS/443) work fine. Changing the environment's *domain* allowlist does **not** fix
this — it's a protocol/port limitation of the HTTP/HTTPS proxy, not a domain block.

**To finish the gate, run the write half where egress is open** (see below).

### Cross-checked against the official Hedera skill

Validated this spike against Hedera's own
[`hedera-dev/hedera-skills`](https://github.com/hedera-dev/hedera-skills) →
`plugins/native-services-js/skills/hedera-consensus-service`. It prescribes the exact
pattern we use (`TopicCreateTransaction` → `TopicMessageSubmitTransaction` →
`.execute(client)` → `getReceipt`), and its "Network Transport" note is explicit:
submission *"uses the SDK **gRPC client** to consensus nodes"* — there is **no
HTTP/REST submit path** for HCS. So the skill confirms the sandbox block is inherent,
not a gap in our code. Two notes:

- We adopted the skill's best practice of gating the topic with **admin + submit keys**
  (only the BoA operator/router key may append receipts).
- The skill reads back via the SDK's `TopicMessageQuery.subscribe()` (a mirror-node
  **gRPC stream**); we instead read via the mirror-node **REST API over HTTPS/443**,
  which is both what the task asked for and the only read path that works in-sandbox.

---

## Account source (researched 2026-06-13, not from memory)

You need a funded Hedera **testnet** account to create topics / submit messages
(reads need nothing). Two ways:

1. **Portal (recommended, used here):** <https://portal.hedera.com> → sign in → create a
   testnet account → copy the **Account ID** (`0.0.x`) and a private key. Portal accounts
   can be topped up to ~1,000 testnet HBAR / 24h. Keys may be **ED25519** (default) or
   **ECDSA** (these also have an EVM address).
2. **No-login faucet:** <https://portal.hedera.com/faucet> → paste an account id / EVM
   address → up to **100 testnet HBAR / 24h**. ⚠️ reCAPTCHA-gated, so it can't be driven
   headlessly from a script.

The account provisioned for this spike (public values only — the key lives in
git-ignored `.env`):

```
HEDERA_OPERATOR_ID   = 0.0.9186016
EVM address          = 0xf43085a8ef340cc22b0798760a6d2fadf84fd53b   (⇒ ECDSA key)
HEDERA_OPERATOR_KEY_TYPE = ECDSA
```

> Testnet is **reset periodically** — accounts and topics get wiped. If `spike` fails
> with an account/key error after a reset, re-fund and refresh `.env`.

Put credentials in `.env` (git-ignored). **Never commit `.env`.**

```bash
cp .env.example .env
# edit .env: HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, HEDERA_OPERATOR_KEY_TYPE (=ECDSA here)
```

---

## How to run

```bash
cd spikes/hedera
npm install

npm run verify-read   # live mirror-node READ rail — no creds, works in the sandbox
npm run fallback      # local signed-digest rail — no creds, works in the sandbox
npm run spike         # full create→submit→read — needs .env creds AND open gRPC egress (run locally)
npm run typecheck     # tsc --noEmit over everything
```

- **Mirror node endpoint:** `https://testnet.mirrornode.hedera.com`
  - all messages: `/api/v1/topics/{topicId}/messages`
  - one message:  `/api/v1/topics/{topicId}/messages/{sequenceNumber}`
  - message bodies are **base64**; the scripts decode them.
- **Router key:** `ROUTER_PRIVATE_KEY` in `.env` (any secp256k1 key). If unset, an
  ephemeral key is generated per run and its address printed — the signature is still
  real, just not stable across runs.

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

### ✅ `npm run spike` — full create→submit→read round-trip (live testnet, 2026-06-14)

Executed from a teleported local terminal (open gRPC egress):

```
=== BoA HCS proof-rail spike (Hedera testnet) ===
operator:              0.0.9186016
router signer address: 0x0AA6C6090c9d733C226BD55A6089E2A31aCc3721

[1] router-signed usage receipt: { "request_id": "req_e877d428-…", … }
    recovered signer (anyone can verify): 0x0AA6C6090c9d733C226BD55A6089E2A31aCc3721   ← signature VALID
[2] created topic: 0.0.9227461
[3] submitted receipt → consensus sequence number: 1
[4] reading back: https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.9227461/messages/1
    sequence_number: 1   consensus_timestamp: 1781397188.243630630

=== RESULT ===
topicId:          0.0.9227461
sequenceNumber:   1
receipt digest:   0x1fa6563e54fd3d8b84fc822ca0fd96eeee736690ba8fdd64e6aa8dd1d8ec915d
bytes round-trip: MATCH
router signature: VALID (recovered 0x0AA6C6090c9d733C226BD55A6089E2A31aCc3721)
hashscan:         https://hashscan.io/testnet/topic/0.0.9227461

PASS ✅  proof rail works: a router-signed receipt was submitted to HCS and read back identical from the mirror node.
```

The topic, message, and read-back are all on live testnet — verify independently at
<https://hashscan.io/testnet/topic/0.0.9227461> or
`GET https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.9227461/messages/1`.
(Run *inside* the Claude-Code-web sandbox this step instead fails at the gRPC boundary —
see "The sandbox egress blocker".)

### ✅ `npm run fallback` — signed-receipt + digest rail

```
=== BoA fallback proof rail (local signed-digest receipt) ===
router signer address: 0xFb20Edc8A0Dad456777a42C97397FF57b4fE3341
[write] digest (immutability anchor → would be written to agent ENS text record):
        0x6bafa1726b53d3c62739e533a61a706e936119befa893d3ac2e2d260acc1e146
=== RESULT ===
digest recompute: MATCH
router signature: VALID (recovered 0xFb20Edc8A0Dad456777a42C97397FF57b4fE3341)
PASS ✅  fallback rail works: router-signed receipt + sha-256 digest persisted and verified locally.
```

---

## Reproducing the live run (open-egress host)

The gate was closed by teleporting the session to a local terminal (open gRPC egress)
and running the spike. To reproduce on any laptop:

```bash
cd spikes/hedera
cp .env.example .env     # fill in the 0.0.9186016 ECDSA creds (or any funded testnet account)
npm install
npm run spike
```

A successful run prints `topicId`, the consensus `sequenceNumber`, the decoded JSON
read back from the mirror node, `bytes round-trip: MATCH`, `router signature: VALID`,
a HashScan link, and a final `PASS ✅`.

**Closed — live testnet result (2026-06-14):**

```
topicId:        0.0.9227461        ✅
sequenceNumber: 1
hashscan:       https://hashscan.io/testnet/topic/0.0.9227461
mirror node:    https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.9227461/messages/1
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
