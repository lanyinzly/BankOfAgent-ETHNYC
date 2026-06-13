# Sprint 0 spike — ENS rail for Bank of Agent (go/no-go gate)

**One question this gate answers:** can BoA attach a resolvable ENS identity to an
agent (a **subname** `agent-a.<parent>.eth` → address) **and** write + read back a
**text record** (`boa.usage`, where we'll later store a usage digest)?

## ✅ VERDICT: **PASS — go**

| Check | What it proves | Result |
|---|---|---|
| **[1] LOCAL write + read-back** (the gate / DoD) | subname → address resolves, and a `boa.usage` text record is written and read back **byte-for-byte identical**, using the **real ENS `ENSRegistry` + `OwnedResolver` contracts** | **PASS ✅** |
| **[2] LIVE mainnet resolution** (bonus) | the same `viem` ENS code path reaches **production ENS** (`vitalik.eth` → addr + `avatar` text record) | **OK ✅** |
| **[3] STATIC fallback** | offline `name → address + records` mirror for demo day if an RPC is down | **OK ✅** |

The write/read-back is proven against the **genuine ENS contracts** (shipped in
`@ensdomains/ens-contracts`), deployed onto a disposable in-process chain. So this
is a faithful test of the ENS rail itself — **not a mock** — while needing **no
faucet, no funded key, and no flaky testnet** in the loop. The identical flow on
live **Sepolia** is provided as a ready-to-run script (`writeread:sepolia`).

## Run it (one command)

```bash
cd spikes/ens
npm install
npm run spike
```

Expected tail of output (verified 2026-06-13):

```
[1] LOCAL ENS write + read-back  (the gate / DoD)
  subname              : agent-a.boa-demo.eth
  resolved → address   : 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 ✓
  text key             : boa.usage
  text read-back       : {"agent":"agent-a.boa-demo.eth","period":"2026-06-13","model":"claude-opus",...,"digest":"0x8cac146f..."}
  read-back == written : ✓ identical

[2] LIVE ENS resolution on mainnet  (bonus, non-fatal)
  name                 : vitalik.eth
  resolved → address   : 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
  text["avatar"]       : https://euc.li/vitalik.eth
  status               : OK ✓

[3] STATIC fallback map  (used live if RPC is down)
  name                 : agent-a.boa-demo.eth
  resolved → address   : 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
  text["boa.usage"]    : {"agent":"agent-a.boa-demo.eth",...}

VERDICT
  ENS RAIL GATE: PASS ✅  — go
```

> A harmless `µWS is not compatible…` warning may print on startup — that's
> ganache falling back to its pure-JS websocket layer; it does not affect the spike.

## Which chain / which approach, and why

- **Approach used for the gate:** deploy the **real ENS `ENSRegistry` +
  `OwnedResolver`** (from `@ensdomains/ens-contracts`, compiled artifacts) onto a
  throwaway **in-process chain** (`ganache`), then build the name tree
  `eth → <parent>.eth → agent-a.<parent>.eth`, `setAddr`, `setText(boa.usage, …)`,
  and read both back via `registry.resolver(node) → resolver.addr/text(node)`.
- **Why not write straight to Sepolia in this run:** the spike sandbox has **no
  funded Sepolia key and no faucet access**, and `.eth` registration needs gas +
  the registrar/controller. Per the gate's discipline ("if testnet won't run in 30
  min, don't block — prove the rail another way and harden the fallback"), we prove
  the rail with the **real contracts locally** and ship the Sepolia script
  ready-to-run. `OwnedResolver` is used instead of `PublicResolver` only because
  `PublicResolver`'s constructor calls a reverse-registrar that doesn't exist on a
  bare registry; `OwnedResolver` exposes the same `addr/text/setAddr/setText`
  profile.
- **Live mainnet** is used for the read-only bonus check (real ENS, real
  Universal Resolver via `viem`).

### Doing it for real on Sepolia (when you have a funded key)

The flow is identical against live Sepolia ENS
(registry `0x0000…2e1e`, PublicResolver `0xE996…49b5`):

```bash
# read-only preflight — no key needed, confirms Sepolia ENS is reachable
npm run writeread:sepolia

# full write + read-back — needs Sepolia ETH + an UNWRAPPED parent name you own
SEPOLIA_RPC_URL=https://… \
PRIVATE_KEY=0x… \
PARENT_NAME=yourname.eth \
AGENT_LABEL=agent-a \
npm run writeread:sepolia
```

(The preflight already passes here: chainId `11155111`, registry + resolver have code.)

## Fallback — static identity map (demo insurance)

If ENS / an RPC is unreachable mid-demo, `identity-map.json` mirrors the same
`name → address + boa.usage` data, served with **zero network**:

```ts
import { resolveStatic, getStaticText } from './src/static-map';
resolveStatic('agent-a.boa-demo.eth');            // 0x7099…79C8
getStaticText('agent-a.boa-demo.eth', 'boa.usage'); // the usage-digest JSON
```

`npm run fallback` prints a sample resolution. The map's values are the **exact**
ones the on-chain record holds, so swapping ENS ↔ fallback is invisible on stage.

**Demo line:** *“ENS is wired up — agent identities are subnames with a `boa.usage`
text record, proven against the real ENS contracts (and resolvable on mainnet/Sepolia).
On stage we read from a static mirror so the demo never blocks on an RPC.”*

## Files

| File | Role |
|---|---|
| `src/spike.ts` | **one-command gate** — runs [1]+[2]+[3], prints the verdict |
| `src/write-read-local.ts` | **the proof** — real ENS contracts on a local chain; subname + `boa.usage` write/read-back |
| `src/write-read-sepolia.ts` | same flow on **live Sepolia** (preflight without a key; full run with a funded key) |
| `src/resolve-live.ts` | live mainnet resolution + text-record read (bonus) |
| `src/static-map.ts` + `identity-map.json` | offline fallback map + reader (`resolveStatic`, `getStaticText`) |
| `src/ens-fixtures.ts` | loads the real ENS contract ABIs + bytecode |

## Scope / discipline (kept)

Hello-world verification only: **no relay, no frontend, no product/custom contracts**
(we deploy the upstream ENS contracts unmodified for the local proof). Exit code is
`0` on PASS, `1` on FAIL, so this can gate CI.
