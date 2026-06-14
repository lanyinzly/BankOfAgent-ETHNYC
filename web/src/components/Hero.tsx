import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap, SplitText, prefersReducedMotion } from '../lib/gsap';
import PriceCurve from './PriceCurve';
import type { BuyResult, PriceQuote } from '../types';

interface Props {
  price: PriceQuote | null;
  lastBuy: BuyResult | null;
  onRunLoop: () => void;
  auto: boolean;
  busy: boolean;
  autoStep: number | null;
}

export default function Hero({ price, lastBuy, onRunLoop, auto, busy, autoStep }: Props) {
  const root = useRef<HTMLElement>(null);
  const headline = useRef<HTMLHeadingElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion || !root.current) return;
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      if (headline.current) {
        const split = new SplitText(headline.current, { type: 'words,lines', linesClass: 'line' });
        tl.from(split.words, { yPercent: 115, opacity: 0, duration: 0.9, stagger: 0.035 });
      }
      tl.from('.hero2__eyebrow', { opacity: 0, y: 12, duration: 0.6 }, 0)
        .from('.hero2__sub', { opacity: 0, y: 18, duration: 0.7 }, '-=0.45')
        .from('.hero2__thesis', { opacity: 0, y: 18, duration: 0.7 }, '-=0.55')
        .from('.hero2__cta > *', { opacity: 0, y: 14, duration: 0.6, stagger: 0.1 }, '-=0.45')
        .from('.hero2__instrument', { opacity: 0, y: 30, duration: 1.0 }, '-=0.7');
    },
    { scope: root },
  );

  return (
    <section className="hero2" ref={root}>
      <div className="hero2__copy">
        <p className="hero2__eyebrow">Bank of Agent · ETHNYC</p>
        <h1 className="hero2__headline" ref={headline}>
          A programmable bank account for agents.
        </h1>
        <p className="hero2__sub">
          Every agent gets an <b>identity</b>, an <b>access membership</b>, a <b>payment rail</b>, and{' '}
          <b>verifiable usage receipts</b> — one account for the whole agent economy.
        </p>
        <p className="hero2__thesis">
          BoA is a mechanism for discovering what agent compute is <em>worth</em> — where human and
          agent enthusiasm is an <em>input</em> to that price, not just an after-effect.
        </p>
        <div className="hero2__cta">
          <button className="btn btn--primary btn--xl" onClick={onRunLoop} disabled={auto || busy}>
            {auto ? `running step ${autoStep ?? ''}…` : '▶ Run the live demo'}
          </button>
          <a className="btn btn--xl" href="#loop">
            Explore the loop ↓
          </a>
        </div>
      </div>

      <div className="hero2__instrument">
        <PriceCurve price={price} lastBuy={lastBuy} />
      </div>
    </section>
  );
}
