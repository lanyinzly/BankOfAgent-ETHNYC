// Agent Payments (Hedera) — the AI & Agentic Payments view.
//
// Every "Run a paid agent call" drives a live loop on Hedera testnet via
// boa-hedera-service: PRICE (FOAMM premium) → SETTLE (real USDC HTS transfer
// agent→provider) → SIGN (router) → RECORD (HCS) → VERIFY (mirror node). No key
// in the browser; the API holds them. LIVE-only (VITE_BOA_HEDERA_API).

import { useEffect, useState } from 'react';
import { emitReceiptStream, fetchAuditLog, fetchHealth, HEDERA_ENABLED, type AuditRow } from '../lib/hederaApi';
import './agentPayments.css';

const STEPS = ['Price', 'Settle', 'Sign', 'Record', 'Verify'] as const;

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values),
    hi = Math.max(...values),
    W = 180,
    H = 38;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * W},${H - ((v - lo) / (hi - lo || 1)) * (H - 4) - 2}`)
    .join(' ');
  return (
    <svg width={W} height={H} className="pay-spark">
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={pts} />
    </svg>
  );
}

export default function AgentPaymentsDemo() {
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [price, setPrice] = useState<any>(null);
  const [settleInfo, setSettleInfo] = useState<any>(null);
  const [signInfo, setSignInfo] = useState<any>(null);
  const [seq, setSeq] = useState<number | null>(null);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<AuditRow[]>([]);
  const [health, setHealth] = useState<any>(null);
  const [form, setForm] = useState({ agent_ens: 'agent-a.boa.eth', model: 'openai/gpt-4o' });

  const refresh = () => fetchAuditLog().then(setLog).catch(() => {});
  useEffect(() => {
    if (!HEDERA_ENABLED) return;
    fetchHealth().then(setHealth).catch(() => {});
    refresh();
  }, []);

  function run() {
    setBusy(true);
    setErr(null);
    setResult(null);
    setSettleInfo(null);
    setSignInfo(null);
    setSeq(null);
    setPrice(null);
    setActive(0);
    emitReceiptStream(form, {
      onPrice: (d) => {
        setPrice(d);
        setActive(1);
      },
      onSettle: (d) => {
        setSettleInfo(d);
        setActive(2);
      },
      onSign: (d) => {
        setSignInfo(d);
        setActive(3);
      },
      onSubmit: (d) => {
        setSeq(d.sequenceNumber);
        setActive(4);
      },
      onVerifyStart: () => setActive(4),
      onDone: (d) => {
        setResult(d);
        setActive(5);
        setBusy(false);
        refresh();
      },
      onError: (m) => {
        setErr(m);
        setBusy(false);
        setActive(-1);
      },
    });
  }

  const curve = [...log]
    .reverse()
    .map((r) => Number(r.receipt?.price_after))
    .filter(Number.isFinite);

  if (!HEDERA_ENABLED) {
    return (
      <section className="boa-pay" id="payments">
        <Header health={null} />
        <div className="pay-notice">
          <b>Agent Payments is live-only.</b> Set <code>VITE_BOA_HEDERA_API</code> to your deployed{' '}
          <code>boa-hedera-service</code> URL to price a call on the FOAMM curve, settle it in{' '}
          <b>USDC on Hedera (HTS)</b>, and anchor a signed receipt on <b>HCS</b>.
        </div>
      </section>
    );
  }

  return (
    <section className="boa-pay" id="payments">
      <Header health={health} />

      <div className="pay-controls">
        <input value={form.agent_ens} onChange={(e) => setForm({ ...form, agent_ens: e.target.value })} placeholder="agent ENS" />
        <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="model" />
        <button disabled={busy} onClick={run}>
          {busy ? 'Running…' : 'Run a paid agent call'}
        </button>
      </div>

      {/* headline: on-chain price discovery */}
      {price && (
        <div className="pay-ticker">
          <span className="pay-ticker__from">{price.priceBefore}</span>
          <span className="pay-ticker__arrow">→</span>
          <strong className="pay-ticker__to">{price.priceAfter}</strong>
          <span className="pay-up">▲ +{price.delta}</span>
          <span className="pay-ticker__label">FOAMM premium · discovered on-chain</span>
        </div>
      )}
      {curve.length > 1 && (
        <div className="pay-curve">
          <Sparkline values={curve} />
          <span>forward curve emitted by the market</span>
        </div>
      )}

      {/* 5-step pipeline */}
      <div className="pay-steps">
        {STEPS.map((label, i) => (
          <div key={label} className={`pay-step ${i < active ? 'done' : i === active ? 'active' : ''}`}>
            <span className="pay-step__dot">{i < active ? '✓' : i + 1}</span>
            <span>{label}</span>
          </div>
        ))}
      </div>

      {settleInfo && (
        <div className="pay-settle">
          paid <b>{settleInfo.amount} {settleInfo.asset}</b> on Hedera{' '}
          <span className="pay-dim">{settleInfo.from} → {settleInfo.to}</span>
          {settleInfo.configured ? (
            settleInfo.hashscanUrl && (
              <a href={settleInfo.hashscanUrl} target="_blank" rel="noreferrer">
                payment tx ↗
              </a>
            )
          ) : (
            <span className="pay-dim">(settlement not configured — run setup:hts)</span>
          )}
        </div>
      )}
      {signInfo && (
        <div className="pay-line pay-dim">
          signed by router <code>{signInfo.routerAddress}</code>
        </div>
      )}
      {seq != null && (
        <div className="pay-line">
          consensus sequence <strong>#{seq}</strong>
        </div>
      )}

      {result && (
        <div className="pay-result">
          <span className="pay-badge ok">on-chain ✓</span>
          {result.signatureValid && <span className="pay-badge ok">signature verified ✓</span>}
          {result.bytesMatch && <span className="pay-badge ok">read-back MATCH ✓</span>}
          <div className="pay-line">
            paid {result.receipt?.total_cost_usdc} USDC · consensus {result.consensusTimestamp}
          </div>
          <div className="pay-links">
            <a href={result.hashscanUrl} target="_blank" rel="noreferrer">
              View on HashScan ↗
            </a>
            <a href={result.mirrorUrl} target="_blank" rel="noreferrer">
              Raw mirror JSON ↗
            </a>
          </div>
          <details>
            <summary>signed receipt</summary>
            <pre>{JSON.stringify(result.receipt, null, 2)}</pre>
          </details>
        </div>
      )}
      {err && <div className="pay-err">⚠ {err}</div>}

      {/* append-only payment audit trail */}
      <h3 className="pay-h3">
        Payment audit trail <span className="pay-sub">GET /api/receipts · immutable on Hedera HCS</span>
      </h3>
      {log.length === 0 ? (
        <div className="pay-empty">No receipts yet — run a paid agent call ⬆</div>
      ) : (
        <div className="pay-tablewrap">
          <table className="pay-table">
            <thead>
              <tr>
                <th>#</th>
                <th>agent</th>
                <th>model</th>
                <th>price</th>
                <th>USDC</th>
                <th>consensus ts</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {log.map((r) => (
                <tr key={r.sequenceNumber}>
                  <td>{r.sequenceNumber}</td>
                  <td className="mono">{r.receipt?.agent_ens}</td>
                  <td>{r.receipt?.model}</td>
                  <td className="mono">{r.receipt?.price_after}</td>
                  <td className="mono">{r.receipt?.total_cost_usdc}</td>
                  <td className="mono pay-dim">{r.consensusTimestamp}</td>
                  <td>
                    <a href={r.hashscanUrl} target="_blank" rel="noreferrer">
                      HashScan ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Header({ health }: { health: any }) {
  return (
    <div className="pay-head">
      <div>
        <div className="pay-kicker">Hedera · AI &amp; agentic payments</div>
        <h2 className="pay-title">Agent Payments</h2>
        <p className="pay-tag">On-chain, permissionless price discovery for the agent economy — priced by FOAMM, settled &amp; audited on Hedera.</p>
      </div>
      {health && (
        <div className="pay-badge2">
          <span className="pay-dot pay-dot--on" /> Hedera {health.network} · settlement {health.settlement}
          {health.topicId && (
            <a href={`https://hashscan.io/testnet/topic/${health.topicId}`} target="_blank" rel="noreferrer" className="mono">
              topic {health.topicId}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
