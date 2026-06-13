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
| **[4] LIVE SEPOLIA write + read-back** (real testnet, funded) | registered `boa-spike-20584f76.eth`, created `agent-a.boa-spike-20584f76.eth`, wrote + read back `boa.usage` **on-chain** via the Universal Resolver | **PASS ✅** |

The write/read-back is proven two ways: against the **genuine ENS contracts**
(shipped in `@ensdomains/ens-contracts`) on a disposable in-process chain — **no
faucet/key/testnet needed** — and **for real on Sepolia** (a funded key registered
a name and wrote the record on-chain). Both are faithful tests of the ENS rail, not mocks.

**Live Sepolia artifacts** (run 2026-06-13):
- subname: [`agent-a.boa-spike-20584f76.eth`](https://sepolia.app.ens.domains/agent-a.boa-spike-20584f76.eth) → `0x7099…79C8`
- register tx: [`0xbc4e2369…56e52a`](https://sepolia.etherscan.io/tx/0xbc4e2369bd6be1b3da8d883502efe00dda0aeebf6a10f3afb67f8f9beb56e52a)
- full record + links saved in [`sepolia-result.json`](./sepolia-result.json)

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
  `OwnedResolver` is used instead of `PublicResolver` only because the latter's
  constructor calls a reverse-registrar that doesn't exist on a bare registry;
  `OwnedResolver` exposes the same `addr/text/setAddr/setText` profile.
- **Live mainnet** is used for the read-only bonus check (real ENS, real
  Universal Resolver via `viem`).
- **Live Sepolia** registers a real `.eth`, creates the subname, and writes/reads
  the `boa.usage` record fully on-chain (see [4] above).

### Doing it for real on Sepolia (funded key)

```bash
# the funded key lives in spikes/ens/.sepolia-key (gitignored) — or pass PRIVATE_KEY
npm run sepolia:full
# optional overrides: PARENT_LABEL=mylabel AGENT_LABEL=agent-a AGENT_ADDRESS=0x… npm run sepolia:full
```

It registers `boa-spike-<rand>.eth`, creates `agent-a.…`, writes `setAddr` +
`boa.usage`, reads both back via the Universal Resolver, and saves
`sepolia-result.json`. A 1-year registration cost **0 test-ETH** on the live
controller (just gas).

#### ⚠️ Gotcha — Sepolia ENS is mid-migration to ENSv2

The controller address published **both** in `@ensdomains/ens-contracts` **and** on
`docs.ens.domains` (`0xfb3cE5…F1f968`) has been **removed** as a registrar
controller — calling its `register` reverts with empty data (`onlyController`).
The actually-active controller was found on-chain by reading recent
`NameRegistered` txs on the `.eth` BaseRegistrar (`0x57f1…`):

- **live controller:** `0xdf60C561Ca35AD3C89D24BbA854654b1c3477078`
- it's a **simplified** controller: **no commit/reveal, `value 0`**, and names are
  owned **directly (unwrapped)** by the registrant — so subnames are created with
  `registry.setSubnodeRecord`, not via NameWrapper.

`SEPOLIA_CONTROLLER=0x…` overrides it if the active controller rotates again.
(`writeread:sepolia` is a lighter read-only preflight / owned-parent variant.)

## Live demo runbook (for judges)

Mint a brand-new ENS name on stage — let a judge pick the word:

```bash
cd spikes/ens
npm run demo "ETHGlobal NY"     # → mints ethglobal-ny-<rand>.eth + agent-a.<…> + boa.usage
```

One run = 4 real Sepolia txs (~50–70s; talk while they confirm):
1. **register** → the `.eth` name is **minted on-chain** (an NFT of ownership; you own it)
2. **subname** → `agent-a.<name>.eth` becomes the agent's identity (free, just gas)
3. **setText** → the agent's `boa.usage` digest is written to a text record
4. **read-back** → resolved from ENS via the Universal Resolver — proof it's on-chain

Then drop the printed links in a browser to show it's live:
- `https://sepolia.app.ens.domains/agent-a.<name>.eth` (records visible in the UI)
- the Etherscan `register` tx link

**Pre-demo checklist:** funded key in `.sepolia-key` (balance covers ~25+ mints);
`npm install` done; one rehearsal run; conference wifi can be flaky → if Sepolia
stalls, fall back instantly to `npm run spike` (local, real ENS contracts, no
network) or `npm run fallback` (static map). See below.

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
| `src/register-and-write-sepolia.ts` | **live Sepolia full run** (`sepolia:full`) — registers a name + subname + record on-chain, read-back via Universal Resolver |
| `sepolia-result.json` | saved artifacts from the live Sepolia PASS (name, address, record, tx links) |
| `src/write-read-sepolia.ts` | lighter Sepolia read-only preflight / owned-parent variant |
| `src/resolve-live.ts` | live mainnet resolution + text-record read (bonus) |
| `src/static-map.ts` + `identity-map.json` | offline fallback map + reader (`resolveStatic`, `getStaticText`) |
| `src/ens-fixtures.ts` | loads the real ENS contract ABIs + bytecode |

## Scope / discipline (kept)

Hello-world verification only: **no relay, no frontend, no product/custom contracts**
(we deploy the upstream ENS contracts unmodified for the local proof). Exit code is
`0` on PASS, `1` on FAIL, so this can gate CI.
