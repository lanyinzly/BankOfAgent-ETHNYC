import { useCallback, useEffect, useMemo, useState } from 'react';
import { AGENT_A, AGENT_B, MARKET_ID, RELAY_DISPLAY_URL, RELAY_URL, USING_MOCK } from './config';
import { relay, RelayError } from './lib/relayClient';
import { usd } from './lib/foamm';
import type {
  BuyResult,
  ChatResult,
  Identity,
  PriceQuote,
  RedeemResult,
  TransferResult,
  UsageReceipt,
} from './types';
import StepCard, { type StepStatus } from './components/StepCard';
import UsageReceiptView from './components/UsageReceiptView';
import ConnectAgent from './components/ConnectAgent';
import Hero from './components/Hero';
import Pillars from './components/Pillars';
import Explainer from './components/Explainer';
import Slides from './components/Slides';
import Reveal from './components/Reveal';
import AgentFleet from './components/AgentFleet';
import AgentIdentityWidget from './components/AgentIdentityWidget';
import AgentPaymentsDemo from './components/AgentPaymentsDemo';
import PriceDock from './components/PriceDock';
import GuidedNarration from './components/GuidedNarration';
import ConnectTutorial from './components/ConnectTutorial';
import './guide.css';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// What the guided demo narrates at each auto-step (shown in the banner + drives auto-scroll).
const NARRATION: Record<number, string> = {
  1: 'Connecting Agent A and Agent B — each agent is an ENS identity and audit trail.',
  2: 'Agent A buys membership vouchers — watch the FOAMM premium tick up as forward capacity is claimed.',
  3: 'Agent A makes a metered model call through the relay — quota is charged and a signed usage receipt is issued.',
  4: 'Agent A transfers a voucher to Agent B — a priced claim on future compute changes hands before anyone consumes it.',
  5: 'Agent B redeems the voucher into callable quota — the claim becomes usable access.',
  6: 'Agent B makes its own successful call — the loop closes, end to end.',
  7: 'Done — identity → membership → metered call → transfer → redeem → call, all live.',
};
const NARRATION_TOTAL = 6;

export default function App() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [identityA, setIdentityA] = useState<Identity | null>(null);
  const [identityB, setIdentityB] = useState<Identity | null>(null);

  const [price, setPrice] = useState<PriceQuote | null>(null);
  const [lastBuy, setLastBuy] = useState<BuyResult | null>(null);

  const [voucherId, setVoucherId] = useState<number | null>(null);
  const [voucherStatus, setVoucherStatus] = useState<'active' | 'transferred' | 'redeemed' | null>(null);

  const [promptA, setPromptA] = useState('What is Bank of Agent, and why price compute on a forward curve?');
  const [promptB, setPromptB] = useState('I just redeemed a voucher — confirm my quota and price 1M tokens forward.');
  const [callA, setCallA] = useState<ChatResult | null>(null);
  const [callB, setCallB] = useState<ChatResult | null>(null);

  const [transferRes, setTransferRes] = useState<TransferResult | null>(null);
  const [redeemRes, setRedeemRes] = useState<RedeemResult | null>(null);

  const [ledger, setLedger] = useState<UsageReceipt[]>([]);
  const [qty, setQty] = useState(1);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoStep, setAutoStep] = useState<number | null>(null);
  const [auto, setAuto] = useState(false);
  // economic-loop deck: which single step is on screen (1–6)
  const [step, setStep] = useState(1);

  // ── helpers ────────────────────────────────────────────────────────────────
  const run = useCallback(
    async <T,>(tag: string, fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(tag);
      setError(null);
      try {
        return await fn();
      } catch (e) {
        const msg = e instanceof RelayError ? `relay ${e.status}: ${e.message}` : (e as Error).message;
        setError(msg);
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const refreshPrice = useCallback(async () => {
    const p = await relay.price(MARKET_ID).catch(() => null);
    if (p) setPrice(p);
  }, []);

  const refreshLedger = useCallback(async () => {
    const [a, b] = await Promise.all([
      relay.usage(AGENT_A).catch(() => [] as UsageReceipt[]),
      relay.usage(AGENT_B).catch(() => [] as UsageReceipt[]),
    ]);
    setLedger([...a, ...b].sort((x, y) => y.timestamp - x.timestamp));
  }, []);

  // ── actions ──────────────────────────────────────────────────────────────--
  const connect = useCallback(async () => {
    const res = await run('connect', async () => {
      const [a, b] = await Promise.all([relay.identity(AGENT_A), relay.identity(AGENT_B)]);
      return { a, b };
    });
    if (res) {
      setIdentityA(res.a);
      setIdentityB(res.b);
      setOnline(true);
      await refreshPrice();
      await refreshLedger();
    } else {
      setOnline(false);
    }
  }, [run, refreshPrice, refreshLedger]);

  const doBuy = useCallback(
    async (quantity: number) => {
      const r = await run('buy', () => relay.buy({ agent: AGENT_A, market: MARKET_ID, quantity }));
      if (r) {
        setLastBuy(r);
        setVoucherId(r.tokenId);
        setVoucherStatus('active');
        await refreshPrice();
        await refreshLedger();
      }
      return r;
    },
    [run, refreshPrice, refreshLedger],
  );

  const doCall = useCallback(
    async (agent: string, prompt: string, set: (c: ChatResult) => void) => {
      const r = await run(`call:${agent}`, () => relay.chat(agent, prompt));
      if (r) {
        set(r);
        await refreshLedger();
      }
      return r;
    },
    [run, refreshLedger],
  );

  // tokenId can be passed explicitly (the auto-loop does this to avoid relying on
  // React state that updates mid-sequence); manual clicks fall back to state.
  const doTransfer = useCallback(
    async (tokenIdArg?: number) => {
      const id = tokenIdArg ?? voucherId;
      if (id == null) return;
      const r = await run('transfer', () => relay.transfer({ tokenId: id, from: AGENT_A, to: AGENT_B }));
      if (r) {
        setTransferRes(r);
        setVoucherStatus('transferred');
      }
      return r;
    },
    [run, voucherId],
  );

  const doRedeem = useCallback(
    async (tokenIdArg?: number) => {
      const id = tokenIdArg ?? voucherId;
      if (id == null) return;
      const r = await run('redeem', () => relay.redeem({ tokenId: id, agent: AGENT_B }));
      if (r) {
        setRedeemRes(r);
        setVoucherStatus('redeemed');
      }
      return r;
    },
    [run, voucherId],
  );

  // ── auto-run the whole economic loop (live-demo insurance) ──────────────────
  const runFullLoop = useCallback(async () => {
    setAuto(true);
    try {
      if (!online) {
        setAutoStep(1);
        await connect();
        await sleep(500);
      }
      setAutoStep(2);
      await doBuy(2);
      await sleep(750);
      const lastBuyRes = await doBuy(2);
      const loopVoucher = lastBuyRes?.tokenId;
      await sleep(750);

      setAutoStep(3);
      await doCall(AGENT_A, promptA, setCallA);
      await sleep(750);

      setAutoStep(4);
      await doTransfer(loopVoucher);
      await sleep(750);

      setAutoStep(5);
      await doRedeem(loopVoucher);
      await sleep(750);

      setAutoStep(6);
      await doCall(AGENT_B, promptB, setCallB);
      await sleep(400);
      setAutoStep(7);
    } finally {
      setAuto(false);
    }
  }, [online, connect, doBuy, doCall, doTransfer, doRedeem, promptA, promptB]);

  // Fetch the opening price quote on mount so the curve is live immediately.
  useEffect(() => {
    refreshPrice();
  }, [refreshPrice]);

  // Guided demo drives the deck: the auto-loop's active step becomes the visible
  // page (clamped to 1–6; step 7 is the "done" state, which rests on step 6).
  useEffect(() => {
    if (auto && autoStep != null) setStep(Math.min(6, Math.max(1, autoStep)));
  }, [auto, autoStep]);

  // While the guided demo plays, keep the active step centered on screen.
  useEffect(() => {
    if (!auto) return;
    const el = document.getElementById(`step-${step}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [auto, step]);

  // ── derived step status ─────────────────────────────────────────────────────
  const statuses: Record<number, StepStatus> = useMemo(
    () => ({
      1: online ? 'done' : 'ready',
      2: lastBuy ? 'done' : online ? 'ready' : 'locked',
      3: callA ? 'done' : lastBuy ? 'ready' : 'locked',
      4: transferRes ? 'done' : lastBuy ? 'ready' : 'locked',
      5: redeemRes ? 'done' : transferRes ? 'ready' : 'locked',
      6: callB ? 'done' : redeemRes ? 'ready' : 'locked',
    }),
    [online, lastBuy, callA, transferRes, redeemRes, callB],
  );

  const busyIs = (t: string) => busy === t;

  return (
    <div className="app" id="top">
      {/* persistent floating FOAMM price (appears when you scroll into the demo) */}
      <PriceDock price={price} lastBuy={lastBuy} />
      {/* guided-demo narration banner */}
      <GuidedNarration active={auto} step={autoStep} total={NARRATION_TOTAL} text={autoStep ? NARRATION[autoStep] ?? null : null} />

      {/* ── top nav ── */}
      <nav className="nav">
        <a className="nav__brand" href="#top">
          <span className="nav__logo nav__logo--mark" aria-hidden="true">
            <img src="/logo.svg" alt="" />
          </span>
          <span className="nav__name">BANK OF AGENT</span>
        </a>
        <div className="nav__links">
          <a href="#about">About</a>
          <a href="#loop">Demo</a>
          <a href="#fleet">Fleet</a>
          <a href="#payments">Payments</a>
          <a href="#integrations">Integrations</a>
        </div>
        <a
          className={`pill ${USING_MOCK ? 'pill--mock' : 'pill--live'}`}
          href={USING_MOCK ? RELAY_DISPLAY_URL : RELAY_URL}
          target="_blank"
          rel="noreferrer"
          title="open the live relay"
          style={{ textDecoration: 'none', cursor: 'pointer' }}
        >
          <span className="pill__dot" />
          {USING_MOCK ? 'MOCK RELAY' : 'LIVE RELAY'}
          <span className="pill__url">{USING_MOCK ? RELAY_DISPLAY_URL : RELAY_URL}</span>
        </a>
      </nav>

      <Hero
        price={price}
        lastBuy={lastBuy}
        onRunLoop={runFullLoop}
        auto={auto}
        busy={busy != null}
        autoStep={autoStep}
      />

      <Pillars />
      {/* ── onboarding & integrations (moved up, right after the four primitives) ── */}
      <Slides />
      <Explainer />

      {/* ── the economic loop ── */}
      <section className="loop" id="loop">
        <Reveal>
          <p className="section__eyebrow">The economic loop · live</p>
          <h2 className="section__h">
            A priced claim on future compute, changing hands before anyone consumes it.
          </h2>
          <p className="loop__intro">
            Run it end to end against the in-browser mock relay — or press “Run the live demo”. Each
            step is a real relay call; the FOAMM premium moves the moment capacity is claimed.
          </p>
        </Reveal>

        {error && (
          <div className="toast" role="alert" onClick={() => setError(null)}>
            [ERROR] {error} <span className="toast__x">DISMISS</span>
          </div>
        )}

        {/* the loop — one step at a time (deck) */}
        <div className="deck">
          <div className="deck__stage">
        {/* 1 · identity */}
        {step === 1 && (
        <StepCard
          n={1}
          title="Agent identity"
          status={statuses[1]}
          highlight={autoStep === 1}
          hint="Each agent is an ENS name — its account handle and public audit trail."
        >
          <div className="ids">
            <IdRow role="Agent A" ens={AGENT_A} identity={online ? identityA : null} />
            <IdRow role="Agent B" ens={AGENT_B} identity={online ? identityB : null} />
          </div>
          <button className="btn" onClick={connect} disabled={busyIs('connect')}>
            {busyIs('connect') ? 'connecting…' : online ? 'reconnect to relay' : 'Connect to relay'}
          </button>
        </StepCard>
        )}

        {/* 2 · buy membership */}
        {step === 2 && (
        <StepCard
          n={2}
          title="Buy membership"
          status={statuses[2]}
          highlight={autoStep === 2}
          hint="Wrap ERC-7527 vouchers. Every unit claimed moves the FOAMM premium up the curve."
        >
          <div className="qty">
            <span className="qty__label">capacity units</span>
            {[1, 5, 10].map((q) => (
              <button
                key={q}
                className={`qty__btn ${qty === q ? 'qty__btn--on' : ''}`}
                onClick={() => setQty(q)}
                type="button"
              >
                {q}
              </button>
            ))}
          </div>
          <button
            className="btn btn--primary"
            onClick={() => doBuy(qty)}
            disabled={!online || busyIs('buy')}
          >
            {busyIs('buy') ? 'buying…' : `Buy ${qty} as ${AGENT_A}`}
          </button>
          {lastBuy && (
            <div className="result">
              <div className="result__row">
                <span>voucher{lastBuy.tokenIds && lastBuy.tokenIds.length > 1 ? 's' : ''}</span>
                <b className="mono">
                  #{lastBuy.tokenIds ? lastBuy.tokenIds.join(', #') : lastBuy.tokenId}
                </b>
              </div>
              <div className="result__row">
                <span>paid</span>
                <b>{usd(lastBuy.pricePaid)}</b>
              </div>
              <div className="result__row result__row--move">
                <span>premium</span>
                <b>
                  {usd(lastBuy.priceBefore)} <span className="arrow">→</span>{' '}
                  <span className="up">{usd(lastBuy.priceAfter)} ▲</span>
                </b>
              </div>
            </div>
          )}
        </StepCard>
        )}

        {/* 3 · call as A */}
        {step === 3 && (
        <StepCard
          n={3}
          title="Call a model"
          status={statuses[3]}
          highlight={autoStep === 3}
          hint="One OpenAI-compatible call through the relay, metered against your quota."
        >
          <textarea
            className="ta"
            value={promptA}
            onChange={(e) => setPromptA(e.target.value)}
            rows={2}
          />
          <button
            className="btn btn--primary"
            onClick={() => doCall(AGENT_A, promptA, setCallA)}
            disabled={!lastBuy || busyIs(`call:${AGENT_A}`)}
          >
            {busyIs(`call:${AGENT_A}`) ? 'calling…' : `Send as ${AGENT_A}`}
          </button>
          {callA && <CallResult result={callA} />}
        </StepCard>
        )}

        {/* 4 · transfer */}
        {step === 4 && (
        <StepCard
          n={4}
          title="Transfer voucher"
          status={statuses[4]}
          highlight={autoStep === 4}
          hint="A priced claim on future compute changes hands — before anyone consumes it."
        >
          <div className="flow">
            <span className="mono">{AGENT_A}</span>
            <span className="flow__arrow">→ #{voucherId ?? '—'} →</span>
            <span className="mono">{AGENT_B}</span>
          </div>
          <button
            className="btn btn--primary"
            onClick={() => doTransfer()}
            disabled={!lastBuy || voucherStatus === 'transferred' || voucherStatus === 'redeemed' || busyIs('transfer')}
          >
            {busyIs('transfer') ? 'transferring…' : `Transfer #${voucherId ?? ''} to ${AGENT_B}`}
          </button>
          {transferRes && (
            <div className="result">
              <div className="result__row">
                <span>voucher</span>
                <b className="mono">#{transferRes.tokenId}</b>
              </div>
              <div className="result__row">
                <span>now held by</span>
                <b className="mono">{transferRes.to}</b>
              </div>
              <div className="note">held, but not yet usable — Agent B must redeem it into quota.</div>
            </div>
          )}
        </StepCard>
        )}

        {/* 5 · redeem */}
        {step === 5 && (
        <StepCard
          n={5}
          title="Redeem into quota"
          status={statuses[5]}
          highlight={autoStep === 5}
          hint="Agent B exercises the claim, converting the voucher into usable quota."
        >
          <button
            className="btn btn--primary"
            onClick={() => doRedeem()}
            disabled={!transferRes || voucherStatus === 'redeemed' || busyIs('redeem')}
          >
            {busyIs('redeem') ? 'redeeming…' : `Redeem #${voucherId ?? ''} as ${AGENT_B}`}
          </button>
          {redeemRes && (
            <div className="result">
              <div className="result__row">
                <span>voucher</span>
                <b className="mono">#{redeemRes.tokenId}</b>
              </div>
              <div className="result__row result__row--move">
                <span>status</span>
                <b className="up">redeemed → quota credited ✓</b>
              </div>
            </div>
          )}
        </StepCard>
        )}

        {/* 6 · call as B */}
        {step === 6 && (
        <StepCard
          n={6}
          title="Second agent calls"
          status={statuses[6]}
          highlight={autoStep === 6}
          hint="The voucher worked: Agent B now makes a successful, metered call of its own."
        >
          <textarea
            className="ta"
            value={promptB}
            onChange={(e) => setPromptB(e.target.value)}
            rows={2}
          />
          <button
            className="btn btn--primary"
            onClick={() => doCall(AGENT_B, promptB, setCallB)}
            disabled={!redeemRes || busyIs(`call:${AGENT_B}`)}
          >
            {busyIs(`call:${AGENT_B}`) ? 'calling…' : `Send as ${AGENT_B}`}
          </button>
          {callB && <CallResult result={callB} />}
        </StepCard>
        )}
          </div>

          <div className="deck__nav">
            <button
              className="deck__arrow"
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              disabled={auto || step === 1}
              aria-label="Previous step"
            >
              ←
            </button>
            <div className="deck__meta">
              <span className="deck__count">Step {step} / 6</span>
              <div className="deck__dots" role="tablist">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <button
                    key={n}
                    className={`deck__dot deck__dot--${statuses[n]} ${n === step ? 'deck__dot--on' : ''}`}
                    onClick={() => setStep(n)}
                    disabled={auto}
                    aria-label={`Go to step ${n}`}
                    aria-selected={n === step}
                    role="tab"
                  />
                ))}
              </div>
            </div>
            <button
              className="deck__arrow"
              onClick={() => setStep((s) => Math.min(6, s + 1))}
              disabled={auto || step === 6}
              aria-label="Next step"
            >
              →
            </button>
          </div>
        </div>
      </section>

      {/* ── agent fleet · ENS identity (live Sepolia) ── */}
      <AgentFleet />

      {/* ── agent payments · Hedera (live testnet: HTS settle + HCS audit) ── */}
      <AgentPaymentsDemo />

      {/* ── connect your agent ── */}
      <ConnectAgent />

      {/* ── usage ledger ── */}
      <section className="card ledger">
        <h2 className="card__title">
          <span className="card__num">∑</span> Usage ledger
          <span className="ledger__sub">GET /boa/usage · verifiable delivery</span>
        </h2>
        {ledger.length === 0 ? (
          <p className="ledger__empty">No calls metered yet. Run a model call to populate receipts.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>agent</th>
                <th>model</th>
                <th className="r">prompt</th>
                <th className="r">compl.</th>
                <th className="r">total</th>
                <th className="r">cost</th>
                <th className="r">price (before → after)</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.agent}</td>
                  <td>{r.model}</td>
                  <td className="r">{r.prompt_tokens}</td>
                  <td className="r">{r.completion_tokens}</td>
                  <td className="r">{r.total_tokens}</td>
                  <td className="r">{usd(r.cost, 4)}</td>
                  <td className="r mono">
                    {usd(r.price_before, 4)} → {usd(r.price_after, 4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── how to connect your agent (tutorial) ── */}
      <ConnectTutorial />

      <footer className="ftr">
        <div className="ftr__row">
          <span>Bank of Agent · built at ETHNYC</span>
          <a href="https://erc7527.com" target="_blank" rel="noreferrer">
            ERC-7527 · erc7527.com →
          </a>
        </div>
        <p className="ftr__fine">
          Mock relay implements interface contract v0 · markets · ERC-7527 FOAMM · ENS identity ·
          Hedera + Arc · metered <code>/v1</code>. Set <code>NEXT_PUBLIC_RELAY_URL</code> to go live
          with zero code changes.
        </p>
      </footer>

      {/* always-on agent identity (ENS) — create/connect a wallet → gasless ENS name */}
      <AgentIdentityWidget />
    </div>
  );
}

// ── small inline presentational helpers ────────────────────────────────────--
function IdRow({ role, ens, identity }: { role: string; ens: string; identity: Identity | null }) {
  return (
    <div className="id">
      <div className="id__role">{role}</div>
      <div className="id__ens mono">{ens}</div>
      <div className={`id__addr mono ${identity ? '' : 'id__addr--off'}`}>
        {identity ? `${identity.address.slice(0, 10)}…${identity.address.slice(-6)}` : 'not resolved'}
      </div>
    </div>
  );
}

function CallResult({ result }: { result: ChatResult }) {
  return (
    <div className="call">
      <div className="call__bubble">{result.content}</div>
      <UsageReceiptView receipt={result.usage} />
    </div>
  );
}
