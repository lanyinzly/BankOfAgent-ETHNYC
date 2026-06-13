# Bank of Agent — Web Demo

A single-page demo of the BoA **economic loop**: an agent connects to the relay,
buys a membership, watches the **FOAMM forward curve move up**, calls a model
through the relay (with a metered usage receipt), then **transfers** its voucher
to a second agent who **redeems** it and successfully calls a model of its own.

It ships with a **built-in mock relay**, so the whole loop runs with **zero
backend**. When the real relay is ready, you flip **one env var** — no code
changes.

```
buy  ──▶  call  ──▶  transfer  ──▶  redeem  ──▶  call
 ▲ premium climbs    receipt        voucher       quota      agent B
   on the curve      (x-boa-usage)  changes hands credited   calls ✓
```

---

## Quick start

```bash
cd web
npm install
npm run dev
```

Open the printed URL (default <http://localhost:5173>). With no configuration the
app runs against the **in-browser mock relay** — everything works offline.

Then either click through the steps **1 → 6**, or hit **▶ Run full loop** to play
the entire economic loop automatically (this is the live-demo safety net).

What to watch: the big **FOAMM forward premium** number and the curve at the top.
Every membership you buy pushes the premium **up the curve** — that is the whole
thesis, made visible.

### Build / preview a production bundle

```bash
npm run build      # outputs to dist/
npm run preview    # serves the built bundle
npm run typecheck  # tsc --noEmit
```

---

## Switching from mock to a real relay

The mock and the live relay are reached through the **exact same `fetch` calls**.
The only thing that changes is the base URL.

1. Copy the example env file and set your relay URL:

   ```bash
   cp .env.example .env
   # .env
   NEXT_PUBLIC_RELAY_URL=https://your-relay.example.com
   ```

2. Restart `npm run dev` (or rebuild).

That's it. When `NEXT_PUBLIC_RELAY_URL` is set:

- the in-browser mock (MSW) is **not started**;
- every call goes straight to `<NEXT_PUBLIC_RELAY_URL>/v1/...`, `.../boa/...`;
- the status pill in the header switches from **MOCK RELAY** to **LIVE RELAY**.

Leave the variable **unset or empty** to go back to the mock.

> The variable is read at build/dev start. This project is Vite-based but
> intentionally accepts the `NEXT_PUBLIC_` prefix (see `vite.config.ts`
> `envPrefix`) so the env var name matches the relay interface contract.
> `VITE_RELAY_URL` works as an alias.

### What a real relay must provide

- **CORS** for the web origin.
- **`Access-Control-Expose-Headers: x-boa-usage`** so the browser can read the
  metering receipt header. (If it isn't exposed, the app falls back to the
  OpenAI-style `usage` block in the response body.)

---

## Deploy to Vercel (frontend)

The frontend is a static Vite SPA, so it deploys to Vercel with **no server** —
the mock relay runs entirely in the browser, so a default deploy is a fully
self-contained, shareable demo. `web/vercel.json` is already included (Vite
preset + SPA fallback).

**Option A — CLI** (run from this `web/` directory):

```bash
npx vercel --prod        # first run links/creates the project, then deploys
```

**Option B — Git import:** in the Vercel dashboard, import the repo and set
**Root Directory = `web`**. Framework auto-detects as Vite (build `vite build`,
output `dist`).

### Point the deployment at the relay shim on Railway

In production the frontend talks to the **relay shim, deployed on Railway**. Point
the Vercel deployment at the shim's **public Railway URL** through the
`NEXT_PUBLIC_RELAY_URL` environment variable — set it in **Vercel → Project →
Settings → Environment Variables**, then redeploy. No code changes.

```
NEXT_PUBLIC_RELAY_URL = https://<your-shim>.up.railway.app
```

This is the standard setup: **Vercel (static frontend) → Railway (relay shim) →
models / contracts**. The shim's public URL is shown in the Railway dashboard
(Service → Settings → Networking → Public Domain).

- **Set it to the Railway shim URL** → the deployment becomes **LIVE** and every
  call goes straight to the shim (`<URL>/v1/...`, `<URL>/boa/...`). The shim must
  send CORS for the Vercel origin and
  `Access-Control-Expose-Headers: x-boa-usage` (see above).
- **Leave it unset** → the deployment falls back to the self-contained in-browser
  **mock** (great for sharing the demo without any backend).

> For local development you can equally point `NEXT_PUBLIC_RELAY_URL` at a tunnel
> to a shim running on your machine (e.g. `cloudflared tunnel --url
> http://localhost:8080` or `ngrok http 8080`) instead of the Railway URL.

> Env vars are read at **build time**, so after changing `NEXT_PUBLIC_RELAY_URL`
> on Vercel you must trigger a redeploy for it to take effect.

---

## Relay interface contract v0

The mock (`src/mocks/`) and the live relay both implement exactly this:

| Method & path                       | Returns                                                     |
| ----------------------------------- | ---------------------------------------------------------- |
| `POST /v1/chat/completions`         | OpenAI-compatible. `Authorization: Bearer <agent ENS/key>`. Metering receipt on the **`x-boa-usage`** response header. |
| `GET  /boa/price?market=<id>`       | `{ basePremium, sold, currentPremium, nextPremium }` (+ `market`, `maxSupply`) |
| `POST /boa/membership/buy`          | `{ tokenId, pricePaid, priceBefore, priceAfter }` (+ `tokenIds`) |
| `POST /boa/membership/redeem`       | `{ tokenId }`                                               |
| `POST /boa/membership/transfer`     | `{ tokenId, from, to }`                                     |
| `GET  /boa/usage?agent=<ens>`       | array of usage receipts                                     |
| `GET  /boa/identity?agent=<ens>`    | `{ address, ens }`                                          |

### FOAMM pricing

The mock prices vouchers exactly like the ERC-7527 reference contract
([`EIP7527/src/ERC7527.sol`](https://github.com/lanyinzly/EIP7527)):

```
premium = basePremium + sold × basePremium / 100
```

Each unit of forward capacity claimed lifts the premium by 1% of base — the
straight line you see plotted is the live forward curve.

---

## Connect your own agent

BoA speaks the OpenAI API, so any compatible agent (the demo uses **Hermes** as
the example) joins by pointing its `base_url` at the relay's `/v1` and using its
ENS as the key:

```python
from openai import OpenAI

hermes = OpenAI(
    base_url="https://relay.boa.eth/v1",   # ← the BoA relay /v1
    api_key="agent-a.boa.eth",             # ← your agent's ENS (or key)
)
resp = hermes.chat.completions.create(
    model="boa-router/auto",
    messages=[{"role": "user", "content": "Hedge my Q3 inference cost."}],
)
# Metering receipt → resp's `x-boa-usage` response header.
```

The in-app **“Connect your agent”** panel has copy-paste snippets for Python,
TypeScript, and cURL, pre-filled with the relay URL you have configured.

---

## Project layout

```
web/
├── index.html
├── vite.config.ts          # envPrefix accepts NEXT_PUBLIC_ + VITE_
├── .env.example            # the single switch: NEXT_PUBLIC_RELAY_URL
├── public/
│   └── mockServiceWorker.js # MSW worker (committed; required for the mock)
└── src/
    ├── config.ts           # mock-vs-live resolution from the env var
    ├── types.ts            # relay contract response shapes
    ├── lib/
    │   ├── foamm.ts        # FOAMM pricing math (mirrors ERC7527.sol)
    │   └── relayClient.ts  # the ONLY way the UI talks to the relay (plain fetch)
    ├── mocks/              # the in-browser mock relay (MSW)
    │   ├── handlers.ts     # contract v0 implemented as request handlers
    │   ├── state.ts        # markets, vouchers, ledger, quota gating
    │   ├── hermes.ts       # stand-in model for completions
    │   └── browser.ts      # MSW worker registration
    ├── components/         # PriceCurve (centerpiece), steps, receipts, snippets
    ├── App.tsx             # orchestrates the economic loop
    └── main.tsx            # starts the mock before first render (mock mode only)
```

---

## Notes

- **The core demo is mock-only by default** and has no external dependencies — it
  is designed to run 100% offline as live-demo insurance.
- Identities are static (`agent-a.boa.eth`, `agent-b.boa.eth`), per spec.
- The “quota gate” is real, not cosmetic: a transferred-but-not-redeemed voucher
  does **not** grant access, so the redeem step genuinely unlocks Agent B's call
  (the relay returns `402` otherwise).
```
