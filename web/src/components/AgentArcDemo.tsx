// BoA × Arc — "Best Agentic Economy with Circle Agent Stack".
// One story: autonomous agents buy services from each other per-use in USDC,
// settled on Arc, with no human — and THE PRICE IS DISCOVERED ON-CHAIN BY DEMAND.
import { useCallback, useEffect, useRef, useState } from 'react';
import { arc, ARC_ENABLED, type Balances, type BuyResult, type Quote, type Tool } from '../lib/arcApi';
import './arcDemo.css';

const CIRCLE_STACK = ['Arc', 'USDC', 'x402', 'CCTP V2', 'Circle Programmable Wallets'];
const CHIPS = [
  'On-chain price discovery (FOAMM curve)',
  'Permissionless 402 + USDC — works for ANY agent tool stack',
  'Gas paid in USDC on Arc — true nanopayments',
];

function Hero() {
  return (
    <div className="arc-hero">
      <div className="arc-ribbon">Submitting for: Best Agentic Economy with Circle Agent Stack</div>
      <div className="arc-kicker">Circle Agent Stack</div>
      <h2 className="arc-title">Agent-native price discovery, settled on Arc.</h2>
      <p className="arc-sub">
        Any agent tool (LLM, RAG, data, compute) becomes a service other agents buy per-use in USDC — the
        price is discovered on-chain by demand, permissionless, no human.
      </p>
      <div className="arc-chips">
        {CHIPS.map((c, i) => (
          <span key={i} className="arc-chip">
            {c}
          </span>
        ))}
      </div>
      <div className="arc-badges">
        {CIRCLE_STACK.map((b) => (
          <span key={b} className="arc-badge">
            {b}
          </span>
        ))}
      </div>
    </div>
  );
}

function Curve({ quote }: { quote: Quote | null }) {
  if (!quote) return <div className="arc-empty">loading the demand curve…</div>;
  const W = 560,
    H = 240,
    PAD = 40;
  const xs = quote.curve.map((p) => p.x);
  const ys = quote.curve.map((p) => p.y);
  const xMax = Math.max(...xs, 1),
    yMin = Math.min(...ys),
    yMax = Math.max(...ys) * 1.04;
  const px = (x: number) => PAD + (x / xMax) * (W - PAD - 12);
  const py = (y: number) => H - PAD - ((y - yMin) / (yMax - yMin || 1)) * (H - PAD - 16);
  const line = quote.curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.x)},${py(p.y)}`).join(' ');
  const sold = quote.soldUnits;
  const live = quote.curve.find((p) => p.x === sold) ?? quote.curve[0];
  return (
    <svg className="arc-curve" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="demand-discovered price curve">
      <line className="arc-axis" x1={PAD} y1={H - PAD} x2={W - 8} y2={H - PAD} />
      <line className="arc-axis" x1={PAD} y1={12} x2={PAD} y2={H - PAD} />
      <path className="arc-line" d={line} fill="none" />
      {/* filled "claimed" region up to sold */}
      <path
        className="arc-area"
        d={`M${px(0)},${py(yMin)} ${quote.curve.filter((p) => p.x <= sold).map((p) => `L${px(p.x)},${py(p.y)}`).join(' ')} L${px(sold)},${py(yMin)} Z`}
      />
      <line className="arc-guide" x1={px(sold)} y1={py(live.y)} x2={px(sold)} y2={H - PAD} />
      <g className="arc-marker" style={{ transform: `translate(${px(sold)}px, ${py(live.y)}px)` }}>
        <circle r="9" className="arc-marker__halo" />
        <circle r="4.5" className="arc-marker__dot" />
      </g>
      <text className="arc-axislbl" x={PAD} y={H - 12}>
        units sold (demand) →
      </text>
    </svg>
  );
}

const trunc = (a?: string | null) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || '—');

export default function AgentArcDemo() {
  const [tab, setTab] = useState<'demo' | 'arch'>('demo');
  const [tools, setTools] = useState<Tool[]>([]);
  const [tool, setTool] = useState('gpt-4o');
  const [maxTokens, setMaxTokens] = useState(1024);
  const [prompt, setPrompt] = useState('Summarize today’s ETH news in 3 bullets.');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [bal, setBal] = useState<Balances | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BuyResult | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [settle, setSettle] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  const loadPrice = useCallback(async (tl: string, mt: number) => {
    try {
      setQuote(await arc.price(tl, mt));
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  const loadBalances = useCallback(async () => {
    try {
      setBal(await arc.balances());
    } catch {
      /* ignore poll errors */
    }
  }, []);

  useEffect(() => {
    if (!ARC_ENABLED) return;
    arc.tools().then((t) => {
      setTools(t);
      if (t[0]) setTool(t[0].id);
    }).catch((e) => setErr((e as Error).message));
    loadBalances();
    const iv = setInterval(loadBalances, 4000);
    return () => clearInterval(iv);
  }, [loadBalances]);

  useEffect(() => {
    if (ARC_ENABLED) loadPrice(tool, maxTokens);
  }, [tool, maxTokens, loadPrice]);

  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  function runBuy() {
    setBusy(true);
    setErr(null);
    setResult(null);
    setRevealed(0);
    arc
      .buy({ tool, prompt, maxTokens })
      .then((r) => {
        setResult(r);
        // reveal steps one at a time (~520ms) to animate the x402 handshake
        r.steps.forEach((_, i) => {
          const t = window.setTimeout(() => {
            setRevealed(i + 1);
            if (i === r.steps.length - 1) {
              setBusy(false);
              loadBalances();
              loadPrice(tool, maxTokens); // curve advances
            }
          }, i * 520);
          timers.current.push(t);
        });
      })
      .catch((e) => {
        setErr((e as Error).message);
        setBusy(false);
      });
  }

  function runSettle() {
    setErr(null);
    setSettle({ pending: true });
    arc
      .settle('1')
      .then((s) => {
        setSettle(s);
        loadBalances();
      })
      .catch((e) => {
        setErr((e as Error).message);
        setSettle(null);
      });
  }

  if (!ARC_ENABLED) {
    return (
      <section className="boa-arc" id="arc">
        <Hero />
        <div className="arc-notice">
          <b>Arc agent-economy demo is live-only.</b> Set <code>VITE_BOA_ARC_API</code> to your deployed{' '}
          <code>boa-arc-service</code> URL to discover prices on the FOAMM curve and settle real x402 USDC
          payments on Arc testnet.
        </div>
      </section>
    );
  }

  return (
    <section className="boa-arc" id="arc">
      <Hero />

      <div className="arc-tabs">
        <button className={tab === 'demo' ? 'on' : ''} onClick={() => setTab('demo')}>
          Live demo
        </button>
        <button className={tab === 'arch' ? 'on' : ''} onClick={() => setTab('arch')}>
          Architecture
        </button>
      </div>

      {tab === 'arch' ? (
        <Architecture />
      ) : (
        <>
          {/* PRICE DISCOVERY — the centerpiece */}
          <div className="arc-panel">
            <div className="arc-panel__head">
              <h3>Price discovered on-chain by demand</h3>
              <div className="arc-price">{quote ? `$${quote.priceUsdc}` : '—'}<span> / call</span></div>
            </div>
            <Curve quote={quote} />
            <p className="arc-cap">
              Price discovered on-chain by demand — agent-native, no human. As buyer agents claim capacity,
              the FOAMM premium climbs the curve. <span className="arc-dim">(in-memory now · on-chain Quoter upgrade-ready)</span>
            </p>
          </div>

          {/* AGENT ↔ AGENT COMMERCE */}
          <div className="arc-grid2">
            <div className="arc-card">
              <div className="arc-card__role">Buyer Agent · Circle Programmable Wallet</div>
              <a className="arc-mono" href={bal?.buyer.link ?? '#'} target="_blank" rel="noreferrer">
                {trunc(bal?.buyer.address)}
              </a>
              <div className="arc-balance">{bal ? bal.buyer.usdc : '…'} <span>USDC</span></div>
            </div>
            <div className="arc-card">
              <div className="arc-card__role">Seller Agent / Tool</div>
              <a className="arc-mono" href={bal?.seller.link ?? '#'} target="_blank" rel="noreferrer">
                {trunc(bal?.seller.address)}
              </a>
              <div className="arc-balance arc-balance--seller">{bal ? bal.seller.usdc : '…'} <span>USDC</span></div>
            </div>
          </div>

          <div className="arc-controls">
            <select value={tool} onChange={(e) => setTool(e.target.value)}>
              {tools.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.kind})
                </option>
              ))}
            </select>
            <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="prompt" />
            <label className="arc-slider">
              maxTokens <b>{maxTokens}</b>
              <input type="range" min={256} max={2048} step={256} value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} />
            </label>
            <button className="arc-run" disabled={busy} onClick={runBuy}>
              {busy ? 'purchasing…' : 'Run autonomous purchase'}
            </button>
          </div>

          {result && (
            <ol className="arc-steps">
              {result.steps.slice(0, revealed).map((s, i) => (
                <li key={i} className={`arc-step arc-step--${s.k}`}>
                  <span className="arc-step__dot">✓</span>
                  <div>
                    <div className="arc-step__label">{s.label}</div>
                    {s.priceUsdc && <div className="arc-step__meta">${s.priceUsdc} USDC{s.maxTokens ? ` · ${s.maxTokens} tok` : ''}</div>}
                    {s.txHash && (
                      <a className="arc-step__meta" href={s.explorerUrl} target="_blank" rel="noreferrer">
                        {trunc(s.txHash)} · view on arcscan ↗
                      </a>
                    )}
                    {s.newPriceUsdc != null && (
                      <div className="arc-step__meta">soldUnits → {s.soldUnitsAfter} · new price ${s.newPriceUsdc}</div>
                    )}
                    {s.result && <div className="arc-step__meta arc-dim">{String(s.result.output ?? '').slice(0, 120)}</div>}
                  </div>
                </li>
              ))}
              {revealed >= result.steps.length && (
                <div className="arc-paid">
                  paid <b>${result.paidUsdc} USDC</b> · seller {result.balances.sellerBefore} → <b>{result.balances.sellerAfter}</b>{' '}
                  · <a href={result.explorerUrl} target="_blank" rel="noreferrer">tx ↗</a>
                </div>
              )}
            </ol>
          )}

          {/* SETTLEMENT STRIP */}
          <div className="arc-settle">
            <button onClick={runSettle} disabled={settle?.pending}>
              {settle?.pending ? 'settling…' : 'Send 1 USDC on Arc'}
            </button>
            {settle && !settle.pending && (
              <span className="arc-settle__out">
                A {settle.before.a} → <b>{settle.after.a}</b> · B {settle.before.b} → <b>{settle.after.b}</b> ·{' '}
                <a href={settle.explorerUrl} target="_blank" rel="noreferrer">tx ↗</a>
                <span className="arc-dim"> — one asset, gas in USDC, no ETH.</span>
              </span>
            )}
          </div>
          {err && <div className="arc-err">⚠ {err}</div>}
        </>
      )}

      <div className="arc-foot">
        <span className="arc-dim">
          x402 payments are REAL on Arc testnet. CCTP V2 + Programmable Wallets are coded &amp; gated on a Circle key.
        </span>
      </div>
    </section>
  );
}

function Architecture() {
  return (
    <div className="arc-arch">
      <div className="arc-arch__row">
        <div className="arc-node">Buyer Agent<br /><span>Circle Programmable Wallet</span></div>
        <div className="arc-arrow">POST /infer (x402) →</div>
        <div className="arc-node">Seller Agent / Tool<br /><span>metered relay</span></div>
      </div>
      <div className="arc-arch__row arc-arch__row--rev">
        <div className="arc-node arc-node--ghost">← 402 Payment Required<br /><span>price discovered by demand (FOAMM)</span></div>
      </div>
      <div className="arc-arch__row">
        <div className="arc-node">Buyer Agent</div>
        <div className="arc-arrow">USDC transfer →</div>
        <div className="arc-node arc-node--chain">Arc testnet<br /><span>USDC · gas in USDC · sub-second final</span></div>
        <div className="arc-arrow">← verify receipt</div>
        <div className="arc-node">Seller</div>
      </div>
      <div className="arc-arch__row arc-arch__row--rev">
        <div className="arc-node arc-node--ok">result delivered ✓ · curve advances (reprice)</div>
      </div>
      <p className="arc-cap">
        No human signs. The price is discovered on-chain by demand; settlement + gas are USDC on Arc; the
        same rail works under any agent stack (x402, A2A, Agent Kit, raw SDK).
      </p>
    </div>
  );
}
