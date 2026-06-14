import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap, prefersReducedMotion } from '../lib/gsap';
import { CHAT_API_BASE, CHAT_KEY_DISPLAY, CHAT_MODEL } from '../config';
import Reveal from './Reveal';

const V1 = `${CHAT_API_BASE}/v1`;

interface Slide {
  k: string;
  tag: string;
  title: string;
  body: string;
  visual: ReactNode;
}

const SLIDES: Slide[] = [
  {
    k: '01',
    tag: 'OpenAI-compatible',
    title: 'Connect your agent',
    body: "BoA speaks the OpenAI API. Point any compatible agent at the relay's /v1 and authenticate with its ENS — one line, and it is trading compute.",
    visual: (
      <pre className="slide__code">
        <code>{`from openai import OpenAI

agent = OpenAI(
  base_url="${V1}",
  api_key="${CHAT_KEY_DISPLAY}",
)
agent.chat.completions.create(
  model="${CHAT_MODEL}",
  messages=[...],
)`}</code>
      </pre>
    ),
  },
  {
    k: '02',
    tag: 'ENS',
    title: 'Mint an agent name',
    body: 'Mint an ENS subname as the agent’s identity and audit handle. Usage digests resolve back to it, so anyone can verify what an agent consumed.',
    visual: (
      <div className="slide__diagram">
        <div className="node node--accentless">mint</div>
        <span className="wire">→</span>
        <div className="node node--strong mono">agent-a.boa.eth</div>
        <span className="wire">resolves</span>
        <div className="node mono">0x989f…e948a5</div>
      </div>
    ),
  },
  {
    k: '03',
    tag: 'Hedera · HCS',
    title: 'Verifiable delivery',
    body: 'Each metered receipt is hashed to Hedera Consensus Service — a tamper-proof, timestamped record any third party can audit, independent of any provider’s private log.',
    visual: (
      <div className="slide__diagram slide__diagram--col">
        <div className="node mono">usage receipt · x-boa-usage</div>
        <span className="wire">⇩ hash + submit</span>
        <div className="node node--strong mono">HCS topic 0.0.boa</div>
        <span className="wire">consensus timestamp ✓</span>
      </div>
    ),
  },
  {
    k: '04',
    tag: 'Arc · USDC',
    title: 'Permissionless settlement',
    body: 'Deposit USDC over Arc and BoA credits usable quota instantly. No signup, no KYC — settlement is the on-ramp, and the unit of account stays USDC.',
    visual: (
      <div className="slide__diagram">
        <div className="node node--strong mono">USDC</div>
        <span className="wire">→ Arc →</span>
        <div className="node mono">deposit</div>
        <span className="wire">credits</span>
        <div className="node node--strong mono">quota</div>
      </div>
    ),
  },
];

export default function Slides() {
  const [i, setI] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const n = SLIDES.length;

  const goTo = useCallback(
    (next: number) => {
      const idx = (next + n) % n;
      setI(idx);
      if (trackRef.current) {
        gsap.to(trackRef.current, {
          xPercent: -100 * idx,
          duration: prefersReducedMotion ? 0 : 0.7,
          ease: 'power3.inOut',
        });
      }
    },
    [n],
  );

  // keep the track aligned if it mounts after first paint
  useGSAP(
    () => {
      if (trackRef.current) gsap.set(trackRef.current, { xPercent: -100 * i });
    },
    { dependencies: [], scope: trackRef },
  );

  return (
    <section className="slides" id="integrations">
      <Reveal>
        <p className="section__eyebrow">Onboarding &amp; integrations</p>
        <h2 className="section__h">Plug an agent in, and settle on rails it already trusts.</h2>
      </Reveal>

      <Reveal
        className="slides__stage"
        // arrow-key navigation when the slider has focus
      >
        <div
          className="slides__viewport"
          role="group"
          aria-roledescription="carousel"
          aria-label="BoA integrations"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') goTo(i + 1);
            if (e.key === 'ArrowLeft') goTo(i - 1);
          }}
        >
          <div className="slides__track" ref={trackRef}>
            {SLIDES.map((s) => (
              <article className="slide" key={s.k} aria-hidden={SLIDES[i].k !== s.k}>
                <div className="slide__copy">
                  <div className="slide__head">
                    <span className="slide__k">{s.k}</span>
                    <span className="slide__tag">{s.tag}</span>
                  </div>
                  <h3 className="slide__title">{s.title}</h3>
                  <p className="slide__body">{s.body}</p>
                </div>
                <div className="slide__visual">{s.visual}</div>
              </article>
            ))}
          </div>
        </div>

        <div className="slides__nav">
          <button className="slides__arrow" onClick={() => goTo(i - 1)} aria-label="Previous slide">
            ←
          </button>
          <div className="slides__dots" role="tablist">
            {SLIDES.map((s, idx) => (
              <button
                key={s.k}
                className={`slides__dot ${idx === i ? 'slides__dot--on' : ''}`}
                onClick={() => goTo(idx)}
                aria-label={`Go to ${s.title}`}
                aria-selected={idx === i}
                role="tab"
              />
            ))}
          </div>
          <button className="slides__arrow" onClick={() => goTo(i + 1)} aria-label="Next slide">
            →
          </button>
        </div>
      </Reveal>
    </section>
  );
}
