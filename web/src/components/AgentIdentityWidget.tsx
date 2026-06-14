// Bottom-right floating widget: create/connect an agent wallet → give it a free
// (gasless) ENS identity on Sepolia → display it, re-resolved live on-chain.
// Optional one-click "Claim ownership" hands the name to the agent (still 0 user gas).
import { useEffect, useMemo, useState } from 'react';
import { ENS_API_BASE } from '../config';
import {
  newAgentWallet,
  connectInjected,
  spawnAgent,
  claimOwnership,
  resolveLive,
  type AgentWallet,
  type MintResult,
} from '../lib/ensClient';
import './agentWidget.css';

const LS_KEY = 'boa.agentIdentity';
// A default agent is shown as "connected" out of the box so the UI is never empty.
const DEFAULT_AGENT = { ens: 'agent-a.boa.eth', address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' };
const STEPS = [
  { key: 'subname', label: 'Mint subname' },
  { key: 'address', label: 'Set address' },
  { key: 'usage', label: 'Write boa.usage' },
  { key: 'metadata', label: 'Write metadata' },
] as const;

type Phase = 'idle' | 'wallet' | 'minting' | 'ready' | 'error';
type StepState = 'idle' | 'pending' | 'done';
const trunc = (a?: string) => (a && a.length > 14 ? `${a.slice(0, 7)}…${a.slice(-5)}` : a || '');

export default function AgentIdentityWidget() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [agent, setAgent] = useState<AgentWallet | null>(null);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<Record<string, StepState>>({});
  const [mint, setMint] = useState<MintResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [verified, setVerified] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [usingDefault, setUsingDefault] = useState(true); // a default agent is connected until you make your own

  // restore previous identity (else stay on the default connected agent)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const s = JSON.parse(raw) as { agent: AgentWallet; mint?: MintResult };
        if (s.agent) {
          setAgent(s.agent);
          setMint(s.mint ?? null);
          setPhase(s.mint ? 'ready' : 'wallet');
          setUsingDefault(false);
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (agent) localStorage.setItem(LS_KEY, JSON.stringify({ agent, mint }));
  }, [agent, mint]);

  const configured = ENS_API_BASE !== '';

  const createWallet = () => {
    setAgent(newAgentWallet());
    setErr(null);
    setUsingDefault(false);
    setPhase('wallet');
  };
  const connectWallet = async () => {
    const a = await connectInjected();
    if (!a) return setErr('No injected wallet — use “Create agent wallet”.');
    setAgent({ address: a });
    setErr(null);
    setUsingDefault(false);
    setPhase('wallet');
  };

  const createEns = async () => {
    if (!agent || !name.trim()) return;
    setErr(null);
    setPhase('minting');
    setSteps(Object.fromEntries(STEPS.map((s) => [s.key, 'pending'])));
    try {
      await spawnAgent(
        { name: name.trim(), address: agent.address },
        {
          onStep: (e) => setSteps((p) => ({ ...p, [e.step]: 'done' })),
          onResult: (r) => {
            setMint(r);
            setPhase('ready');
          },
          onError: (m) => {
            setErr(m);
            setPhase('error');
          },
        },
      );
    } catch (e) {
      setErr((e as Error).message);
      setPhase('error');
    }
  };

  // independent on-chain verification once ready
  useEffect(() => {
    if (phase === 'ready' && mint?.ensName) {
      resolveLive(mint.ensName)
        .then((r) => r.address && setVerified(r.address))
        .catch(() => {});
    }
  }, [phase, mint]);

  const claim = async () => {
    if (!agent || !mint) return;
    setClaiming(true);
    setErr(null);
    try {
      const r = await claimOwnership(mint.ensName, agent.address);
      setMint((m) => (m ? { ...m, owner: r.owner, selfCustody: true } : m));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setClaiming(false);
    }
  };

  const reset = () => {
    setMint(null);
    setName('');
    setSteps({});
    setVerified(null);
    setPhase(agent ? 'wallet' : 'idle');
  };

  const usage = useMemo(() => {
    try {
      return mint ? JSON.parse(mint.records['boa.usage']) : null;
    } catch {
      return null;
    }
  }, [mint]);

  // What the collapsed pill shows: the live agent's ENS/address, else the default.
  const connectedName = mint?.ensName ?? (usingDefault ? DEFAULT_AGENT.ens : agent ? trunc(agent.address) : null);

  if (!open) {
    return (
      <button
        className={`aiw-fab ${connectedName ? 'aiw-fab--connected' : ''}`}
        onClick={() => setOpen(true)}
        aria-label="Connect your agent"
      >
        <span className="aiw-fab__dot" />
        <span className="aiw-fab__txt">{connectedName ?? 'Connect your agent'}</span>
      </button>
    );
  }

  return (
    <div className="aiw">
      <div className="aiw-head">
        <span className="aiw-title">Connect your agent</span>
        <button className="aiw-x" onClick={() => setOpen(false)} aria-label="collapse">
          —
        </button>
      </div>

      {phase === 'idle' && (
        <div className="aiw-body">
          {usingDefault && (
            <div className="aiw-card">
              <div className="aiw-ens">{DEFAULT_AGENT.ens}</div>
              <code
                className="aiw-mono aiw-addr"
                title="copy"
                onClick={() => navigator.clipboard.writeText(DEFAULT_AGENT.address)}
              >
                {trunc(DEFAULT_AGENT.address)}
              </code>
              <div className="aiw-badge">default agent · connected</div>
            </div>
          )}
          {configured ? (
            <>
              <p className="aiw-lead">Spin up your own agent — a wallet + a free ENS identity on Sepolia.</p>
              <button className="aiw-btn aiw-btn--primary" onClick={createWallet}>
                Create agent wallet
              </button>
              <button className="aiw-btn" onClick={connectWallet}>
                Connect wallet
              </button>
            </>
          ) : (
            // Once an agent is connected (the default agent, or one you created),
            // drop the config hint — it only matters when nothing is connected yet.
            !connectedName && (
              <div className="aiw-note">
                Set <code>VITE_ENS_API_BASE</code> to your boa-ens-service to spin up your own ENS agent.
              </div>
            )
          )}
        </div>
      )}

      {configured && phase === 'wallet' && agent && (
        <div className="aiw-body">
          <div className="aiw-row">
            <span>agent</span>
            <code className="aiw-mono" title="copy" onClick={() => navigator.clipboard.writeText(agent.address)}>
              {trunc(agent.address)}
            </code>
          </div>
          <input
            className="aiw-input"
            placeholder="name your agent (e.g. scout)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createEns()}
          />
          <button className="aiw-btn aiw-btn--primary" disabled={!name.trim()} onClick={createEns}>
            Create ENS · gasless
          </button>
          <p className="aiw-fine">You pay nothing — the platform signs on Sepolia. The name resolves to your agent wallet.</p>
        </div>
      )}

      {configured && phase === 'minting' && (
        <div className="aiw-body">
          <div className="aiw-steps">
            {STEPS.map((s) => (
              <div key={s.key} className={`aiw-step aiw-step--${steps[s.key] ?? 'idle'}`}>
                <span className="aiw-dot" />
                {s.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {configured && phase === 'ready' && mint && (
        <div className="aiw-body">
          <div className="aiw-card">
            {mint.records.avatar && <img className="aiw-avatar" src={mint.records.avatar} alt="" />}
            <div className="aiw-ens">{mint.ensName}</div>
            <code className="aiw-mono aiw-addr" title="copy" onClick={() => navigator.clipboard.writeText(mint.address)}>
              {trunc(mint.address)}
            </code>
            {usage && (
              <div className="aiw-chip">
                {usage.model} · {usage.requests ?? 0} reqs · {String(usage.digest ?? '').slice(0, 10)}…
              </div>
            )}
            <div className="aiw-badge">{mint.selfCustody ? 'owned by agent ✓ self-custody' : 'platform-managed'}</div>
            {verified && <div className="aiw-verify">✔ resolved on-chain → {trunc(verified)}</div>}
          </div>
          <div className="aiw-links">
            <a href={mint.links.ens} target="_blank" rel="noreferrer">
              View on ENS ↗
            </a>
            <a href={mint.links.etherscan} target="_blank" rel="noreferrer">
              Tx ↗
            </a>
          </div>
          {!mint.selfCustody && (
            <button
              className="aiw-btn"
              disabled={claiming}
              onClick={claim}
              title="Hand registry ownership to the agent — still 0 gas for you"
            >
              {claiming ? 'claiming…' : 'Claim ownership (self-custody)'}
            </button>
          )}
          <button className="aiw-btn aiw-btn--ghost" onClick={reset}>
            New agent
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div className="aiw-body">
          <div className="aiw-err">{err}</div>
          <button className="aiw-btn" onClick={() => setPhase(agent ? 'wallet' : 'idle')}>
            Back
          </button>
        </div>
      )}
      {err && phase !== 'error' && <div className="aiw-err">{err}</div>}
    </div>
  );
}
