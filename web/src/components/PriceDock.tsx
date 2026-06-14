// Persistent FOAMM price readout. The big curve lives in the hero; once you scroll
// into the demo this shrinks into a fixed floating module so the price is ALWAYS
// visible while you watch the loop move it. Flashes red on a premium tick-up.
import { useEffect, useRef, useState } from 'react';
import { forwardCurve, premiumAt, usd } from '../lib/foamm';
import type { BuyResult, PriceQuote } from '../types';
import './priceDock.css';

interface Props {
  price: PriceQuote | null;
  lastBuy: BuyResult | null;
}

export default function PriceDock({ price, lastBuy }: Props) {
  const [docked, setDocked] = useState(false);
  const [bump, setBump] = useState(false);
  const prev = useRef<number>(0);

  useEffect(() => {
    const onScroll = () => setDocked(window.scrollY > window.innerHeight * 0.6);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const sold = price?.sold ?? 0;
  const base = price?.basePremium ?? 10;
  const maxSupply = price?.maxSupply ?? 30;
  const current = price ? price.currentPremium : premiumAt(sold, base);
  const next = price ? price.nextPremium : premiumAt(sold + 1, base);
  const delta = lastBuy ? lastBuy.priceAfter - lastBuy.priceBefore : 0;

  useEffect(() => {
    if (current > prev.current && prev.current > 0) {
      setBump(true);
      const t = setTimeout(() => setBump(false), 1000);
      prev.current = current;
      return () => clearTimeout(t);
    }
    prev.current = current;
  }, [current]);

  // mini sparkline of the curve from 0..window, marker at `sold`
  const W = 132,
    H = 40;
  const win = Math.min(maxSupply, Math.max(sold + 6, 10));
  const pts = forwardCurve(base, maxSupply).filter((p) => p.sold <= win);
  const lo = pts[0].premium,
    hi = pts[pts.length - 1].premium;
  const sx = (s: number) => (s / win) * W;
  const sy = (p: number) => H - 3 - ((p - lo) / (hi - lo || 1)) * (H - 6);
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.sold)},${sy(p.premium)}`).join(' ');

  return (
    <div className={`pdock ${docked ? 'pdock--on' : ''} ${bump ? 'pdock--up' : ''}`} aria-hidden={!docked}>
      <div className="pdock__top">
        <span className="pdock__label">FOAMM premium</span>
        <span className="pdock__mkt">{price?.market ?? 'frontier-llm.q3'}</span>
      </div>
      <div className="pdock__priceRow">
        <span className="pdock__price">{usd(current)}</span>
        {delta > 0 && <span className="pdock__delta">▲ {usd(delta)}</span>}
      </div>
      <svg className="pdock__spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx={sx(Math.min(sold, win))} cy={sy(current)} r="3.5" className="pdock__dot" />
      </svg>
      <div className="pdock__foot">
        <span>{sold}/{maxSupply} claimed</span>
        <span>next {usd(next)}</span>
      </div>
    </div>
  );
}
