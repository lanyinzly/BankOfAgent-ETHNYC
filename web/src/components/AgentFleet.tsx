// Agent Fleet / ENS Identity — the ENS-prize view.
//
// Everything here is LIVE Sepolia ENS via boa-ens-service (ENS_API_BASE):
//   • health badge          GET  /health
//   • fleet directory       GET  /agents   (on-chain discovery, polled)
//   • spawn an agent        POST /agents   (SSE: one step per on-chain tx)
//   • resolve any name      GET  /resolve  (Universal Resolver)
// Plus INDEPENDENT client-side re-resolution with viem (no key in the browser),
// to visibly prove the records are real on-chain ENS, not API mock data.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ENS_API_BASE } from '../config';
import { reader } from '../lib/ensClient';
import './agentFleet.css';

interface Health {
  ok: boolean;
  chainId: number;
  fleetParent: string;
  fleetNode: string;
  resolver: string;
  minting: boolean;
  account: string | null;
  fleetOwner: string | null;
  fleetOwnedByUs: boolean;
  fleetLink: string;
}
interface Agent {
  ensName: string;
  address: string;
  description: string;
  avatar: string;
  boaUsage: string;
  links: { ens: string; etherscan: string };
}

const STEPS = [
  { key: 'subname', label: 'Mint subname' },
  { key: 'address', label: 'Set address' },
  { key: 'usage', label: 'Write boa.usage' },
  { key: 'metadata', label: 'Write metadata' },
] as const;
type StepKey = (typeof STEPS)[number]['key'];
type StepState = 'idle' | 'pending' | 'done' | 'error';

const trunc = (a?: string) => (a && a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a || '');

function parseUsage(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export default function AgentFleet() {
  const [health, setHealth] = useState<Health | null>(null);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const [highlight, setHighlight] = useState<string | null>(null);

  const toast = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const configured = ENS_API_BASE !== '';

  const loadHealth = useCallback(async () => {
    if (!configured) return;
    try {
      const r = await fetch(`${ENS_API_BASE}/health`);
      setHealth(await r.json());
    } catch (e) {
      toast(`health: ${(e as Error).message}`);
    }
  }, [configured, toast]);

  const loadAgents = useCallback(async () => {
    if (!configured) return;
    try {
      const r = await fetch(`${ENS_API_BASE}/agents`);
      setAgents(await r.json());
    } catch (e) {
      toast(`discovery: ${(e as Error).message}`);
    }
  }, [configured, toast]);

  useEffect(() => {
    loadHealth();
    loadAgents();
    if (!configured) return;
    const t = setInterval(loadAgents, 5000); // live, on-chain discovery poll
    return () => clearInterval(t);
  }, [configured, loadHealth, loadAgents]);

  if (!configured) {
    return (
      <section className="boa-ens" id="fleet">
        <Header health={null} />
        <div className="ens-notice">
          <b>Agent Fleet (ENS) is live-only.</b> Set <code>VITE_ENS_API_BASE</code> to your{' '}
          <code>boa-ens-service</code> URL to read the real Sepolia fleet, discover agents
          on-chain, and spawn new ENS identities.
        </div>
      </section>
    );
  }

  return (
    <section className="boa-ens" id="fleet">
      <Header health={health} />
      <div className="ens-grid2">
        <SpawnAgentPanel
          minting={health?.minting ?? false}
          onResult={(a) => {
            setAgents((prev) => [a, ...(prev ?? []).filter((x) => x.ensName !== a.ensName)]);
            setHighlight(a.ensName);
            setTimeout(() => setHighlight(null), 3000);
            loadAgents();
          }}
          toast={toast}
        />
        <ResolveBar toast={toast} prefill={agents?.[0]?.ensName} />
      </div>

      <h3 className="ens-h3">
        Fleet directory <span className="ens-sub">GET /agents · discovered live from on-chain NewOwner events</span>
      </h3>
      <FleetDirectory agents={agents} highlight={highlight} toast={toast} />

      {toasts.length > 0 && (
        <div className="ens-toasts">
          {toasts.map((t) => (
            <div key={t.id} className="ens-toast">
              {t.msg}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Header({ health }: { health: Health | null }) {
  return (
    <div className="ens-head">
      <div>
        <div className="ens-kicker">ENS · identity &amp; discovery</div>
        <h2 className="ens-title">Agent Fleet</h2>
      </div>
      <div className="ens-badge">
        {health ? (
          <>
            <span className="dot dot--on" /> Connected to Sepolia ENS · chain {health.chainId} · fleet{' '}
            <a href={health.fleetLink} target="_blank" rel="noreferrer" className="mono">
              {health.fleetParent}
            </a>
            {health.minting ? (
              <span className="ens-pill ens-pill--ok">minting on</span>
            ) : (
              <span className="ens-pill">read-only</span>
            )}
          </>
        ) : (
          <>
            <span className="dot" /> connecting to ENS service…
          </>
        )}
      </div>
    </div>
  );
}

function Copy({ value }: { value: string }) {
  const [hit, setHit] = useState(false);
  return (
    <button
      className="ens-copy"
      title="copy"
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setHit(true);
        setTimeout(() => setHit(false), 900);
      }}
    >
      {hit ? '✓' : '⧉'}
    </button>
  );
}

function FleetDirectory({
  agents,
  highlight,
  toast,
}: {
  agents: Agent[] | null;
  highlight: string | null;
  toast: (m: string) => void;
}) {
  if (agents === null) return <div className="ens-empty">loading fleet from chain…</div>;
  if (agents.length === 0) return <div className="ens-empty">No agents yet — spawn one ⬇</div>;
  return (
    <div className="ens-cards">
      {agents.map((a) => (
        <AgentCard key={a.ensName} a={a} flash={highlight === a.ensName} toast={toast} />
      ))}
    </div>
  );
}

function AgentCard({ a, flash, toast }: { a: Agent; flash: boolean; toast: (m: string) => void }) {
  const usage = parseUsage(a.boaUsage);
  const digest = usage?.digest as string | undefined;
  const requests = usage?.requests as number | undefined;
  const tokensIn = usage?.tokensIn as number | undefined;
  return (
    <div className={`ens-card${flash ? ' ens-card--flash' : ''}`}>
      <div className="ens-card__top">
        {a.avatar ? <img className="ens-av" src={a.avatar} alt="" /> : <div className="ens-av ens-av--ph" />}
        <div className="ens-card__id">
          <div className="ens-name mono">{a.ensName}</div>
          <div className="ens-addr mono">
            {trunc(a.address)} <Copy value={a.address} />
          </div>
        </div>
      </div>
      {a.description && <div className="ens-desc">{a.description}</div>}
      <div className="ens-usage">
        <span className="ens-chip">
          usage digest{' '}
          <b className="mono">{digest ? `${digest.slice(0, 10)}…` : '—'}</b>
        </span>
        {requests != null && <span className="ens-chip">{requests} req</span>}
        {tokensIn != null && <span className="ens-chip">{Number(tokensIn).toLocaleString()} tok in</span>}
      </div>
      <div className="ens-card__links">
        <a href={a.links.ens} target="_blank" rel="noreferrer">
          View on ENS ↗
        </a>
        <a href={a.links.etherscan} target="_blank" rel="noreferrer">
          Tx ↗
        </a>
        <button
          className="ens-mini"
          onClick={async () => {
            try {
              const addr = await reader.getEnsAddress({ name: a.ensName });
              toast(addr ? `✔ re-resolved on-chain: ${trunc(addr)}` : 'no address on-chain');
            } catch (e) {
              toast(`resolve failed: ${(e as Error).message}`);
            }
          }}
        >
          verify on-chain
        </button>
      </div>
    </div>
  );
}

function SpawnAgentPanel({
  minting,
  onResult,
  toast,
}: {
  minting: boolean;
  onResult: (a: Agent) => void;
  toast: (m: string) => void;
}) {
  const [name, setName] = useState('');
  const [model, setModel] = useState('claude-opus-4-6');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<Record<StepKey, StepState>>({
    subname: 'idle',
    address: 'idle',
    usage: 'idle',
    metadata: 'idle',
  });
  const [txs, setTxs] = useState<Partial<Record<StepKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [resolvable, setResolvable] = useState<string | null>(null);
  const [independent, setIndependent] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const spawn = useCallback(async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setResolvable(null);
    setIndependent(null);
    setTxs({});
    setSteps({ subname: 'pending', address: 'idle', usage: 'idle', metadata: 'idle' });
    abort.current = new AbortController();
    try {
      const res = await fetch(`${ENS_API_BASE}/agents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, model, description }),
        signal: abort.current.signal,
      });
      if (!res.body) throw new Error('no SSE stream');
      const rd = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const order: StepKey[] = ['subname', 'address', 'usage', 'metadata'];
      while (true) {
        const { done, value } = await rd.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = block.match(/^event: (.*)$/m)?.[1];
          const dataLine = block.match(/^data: (.*)$/m)?.[1];
          if (!ev || !dataLine) continue;
          const data = JSON.parse(dataLine);
          if (ev === 'step') {
            const k = data.step as StepKey;
            setSteps((s) => {
              const next = { ...s, [k]: 'done' as StepState };
              const idx = order.indexOf(k);
              if (idx + 1 < order.length) next[order[idx + 1]] = 'pending';
              return next;
            });
            if (data.txHash) setTxs((t) => ({ ...t, [k]: data.txHash }));
          } else if (ev === 'error') {
            toast(`spawn: ${data.message}`);
            setSteps((s) => {
              const cur = order.find((k) => s[k] === 'pending') ?? 'subname';
              return { ...s, [cur]: 'error' };
            });
          } else if (ev === 'result') {
            setResolvable(data.ensName);
            onResult({
              ensName: data.ensName,
              address: data.address,
              description: data.records?.description ?? '',
              avatar: data.records?.avatar ?? '',
              boaUsage: data.records?.['boa.usage'] ?? '',
              links: data.links,
            });
            // INDEPENDENT client-side re-resolution — prove it's real ENS.
            try {
              const addr = await reader.getEnsAddress({ name: data.ensName });
              if (addr) setIndependent(addr);
            } catch {
              /* universal resolver may lag a block; the card still shows */
            }
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast(`spawn failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [name, model, description, busy, onResult, toast]);

  return (
    <div className="ens-panel">
      <h3 className="ens-h3">
        Spawn an agent <span className="ens-sub">POST /agents · real subname under the fleet root</span>
      </h3>
      {!minting && (
        <div className="ens-notice ens-notice--warn">
          service is read-only (no fleet key set) — spawning is disabled until the backend has a
          funded fleet-owner key.
        </div>
      )}
      <div className="ens-form">
        <input
          className="ens-input"
          placeholder="agent name (e.g. researcher)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select className="ens-input" value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="claude-opus-4-6">claude-opus-4-6</option>
          <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
          <option value="claude-haiku-4-5">claude-haiku-4-5</option>
        </select>
        <input
          className="ens-input"
          placeholder="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button className="ens-btn" disabled={!minting || busy || !name.trim()} onClick={spawn}>
          {busy ? 'minting…' : 'Spawn agent'}
        </button>
      </div>

      <div className="ens-stepper">
        {STEPS.map((s, n) => (
          <div key={s.key} className={`ens-step ens-step--${steps[s.key]}`}>
            <span className="ens-step__n">{steps[s.key] === 'done' ? '✓' : n + 1}</span>
            <span className="ens-step__l">{s.label}</span>
            {txs[s.key] && (
              <a
                className="ens-step__tx"
                href={`https://sepolia.etherscan.io/tx/${txs[s.key]}`}
                target="_blank"
                rel="noreferrer"
              >
                tx ↗
              </a>
            )}
          </div>
        ))}
        <div className={`ens-step ens-step--${resolvable ? 'done' : 'idle'}`}>
          <span className="ens-step__n">{resolvable ? '✓' : '✅'}</span>
          <span className="ens-step__l">Resolvable</span>
        </div>
      </div>

      {resolvable && (
        <div className="ens-resolved">
          minted <b className="mono">{resolvable}</b>
          {independent ? (
            <div className="ens-indep">
              ✔ independently resolved on-chain (frontend viem): <b className="mono">{trunc(independent)}</b>
            </div>
          ) : (
            <div className="ens-indep ens-indep--wait">confirming on-chain…</div>
          )}
        </div>
      )}
    </div>
  );
}

function ResolveBar({ toast, prefill }: { toast: (m: string) => void; prefill?: string }) {
  const [name, setName] = useState('');
  const [out, setOut] = useState<{ address: string | null; usage: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const placeholder = useMemo(() => prefill || 'agent.<fleet>.eth', [prefill]);

  const resolve = useCallback(
    async (n: string) => {
      const q = (n || prefill || '').trim();
      if (!q) return;
      setBusy(true);
      setOut(null);
      try {
        // service (Universal Resolver) + an independent frontend viem read
        const [svc, feText] = await Promise.all([
          fetch(`${ENS_API_BASE}/resolve?name=${encodeURIComponent(q)}`).then((r) =>
            r.ok ? r.json() : null,
          ),
          reader.getEnsText({ name: q, key: 'boa.usage' }).catch(() => null),
        ]);
        const address = svc?.address ?? (await reader.getEnsAddress({ name: q }).catch(() => null));
        setOut({ address: address ?? null, usage: svc?.boaUsage ?? feText ?? null });
        if (!address) toast(`no on-chain address for ${q}`);
      } catch (e) {
        toast(`resolve: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [prefill, toast],
  );

  const usage = out?.usage ? parseUsage(out.usage) : null;
  return (
    <div className="ens-panel">
      <h3 className="ens-h3">
        Resolve any agent <span className="ens-sub">GET /resolve · Universal Resolver</span>
      </h3>
      <div className="ens-form ens-form--inline">
        <input
          className="ens-input"
          placeholder={placeholder}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && resolve(name)}
        />
        <button className="ens-btn" disabled={busy} onClick={() => resolve(name)}>
          {busy ? 'resolving…' : 'Resolve'}
        </button>
      </div>
      {out && (
        <div className="ens-resolveout">
          <div className="ens-row">
            <span>address</span>
            <b className="mono">{out.address ? trunc(out.address) : 'not resolved'}</b>
            {out.address && <Copy value={out.address} />}
          </div>
          {usage ? (
            <pre className="ens-json">{JSON.stringify(usage, null, 2)}</pre>
          ) : (
            <div className="ens-row ens-row--dim">no boa.usage record</div>
          )}
        </div>
      )}
    </div>
  );
}
