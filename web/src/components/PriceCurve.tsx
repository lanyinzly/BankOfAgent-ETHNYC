// ─────────────────────────────────────────────────────────────────────────────
// The FOAMM forward curve — the visual centerpiece of the demo.
//
// It draws the deterministic premium line (premium = base + sold·base/100), fills
// the claimed-capacity region up to `sold`, and pins a glowing marker at the live
// premium. On a buy the marker climbs up-and-right and the big premium number
// flips green — "buy moves the price up" has to be the thing you see first.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { forwardCurve, premiumAt, usd } from '../lib/foamm';
import type { BuyResult, PriceQuote } from '../types';

interface Props {
  price: PriceQuote | null;
  lastBuy: BuyResult | null;
}

const W = 720;
const H = 360;
const PAD = { top: 28, right: 24, bottom: 40, left: 56 };

export default function PriceCurve({ price, lastBuy }: Props) {
  const sold = price?.sold ?? 0;
  const basePremium = price?.basePremium ?? 10;
  const maxSupply = price?.maxSupply ?? 30;
  const current = price ? price.currentPremium : premiumAt(sold, basePremium);

  const curve = forwardCurve(basePremium, maxSupply);

  // Y domain framed to the active region so even a single +1% step reads clearly,
  // while the whole forward line stays visible.
  const yMin = basePremium * 0.985;
  const yMax = premiumAt(Math.min(maxSupply, Math.max(sold + 6, 8)), basePremium) * 1.02;

  const px = (s: number) =>
    PAD.left + (s / maxSupply) * (W - PAD.left - PAD.right);
  const py = (p: number) =>
    PAD.top + (1 - (p - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);

  const linePath = curve.map((pt, i) => `${i === 0 ? 'M' : 'L'}${px(pt.sold)},${py(pt.premium)}`).join(' ');
  const claimed = curve.filter((pt) => pt.sold <= sold);
  const areaPath =
    `M${px(0)},${py(yMin)} ` +
    claimed.map((pt) => `L${px(pt.sold)},${py(pt.premium)}`).join(' ') +
    ` L${px(sold)},${py(yMin)} Z`;

  const markerX = px(sold);
  const markerY = py(current);

  // Flash the headline number green whenever the premium rises.
  const [bump, setBump] = useState(false);
  const prev = useRef(current);
  useEffect(() => {
    if (current > prev.current) {
      setBump(true);
      const t = setTimeout(() => setBump(false), 900);
      prev.current = current;
      return () => clearTimeout(t);
    }
    prev.current = current;
  }, [current]);

  const delta = lastBuy ? lastBuy.priceAfter - lastBuy.priceBefore : 0;
  const deltaPct = lastBuy && lastBuy.priceBefore > 0 ? (delta / lastBuy.priceBefore) * 100 : 0;

  // Horizontal grid lines.
  const ticks = 4;
  const gridY = Array.from({ length: ticks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / ticks);

  return (
    <div className="curve">
      <div className="curve__head">
        <div>
          <div className="curve__label">FOAMM forward premium · {price?.market ?? '—'}</div>
          <div className="curve__sub">premium = base + sold × base ⁄ 100 · the live forward curve</div>
        </div>
        <div className={`curve__price ${bump ? 'curve__price--up' : ''}`}>
          <span className="curve__priceNum">{usd(current)}</span>
          <span className="curve__priceUnit">/ unit</span>
          {lastBuy && delta > 0 && (
            <span className="curve__delta">
              ▲ {usd(delta)} (+{deltaPct.toFixed(2)}%)
            </span>
          )}
        </div>
      </div>

      <svg className="curve__svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="FOAMM forward premium curve">
        <defs>
          <linearGradient id="boaArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(34,211,238,0.34)" />
            <stop offset="100%" stopColor="rgba(34,211,238,0.02)" />
          </linearGradient>
          <linearGradient id="boaLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#a78bfa" />
          </linearGradient>
          <filter id="boaGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* grid + y labels */}
        {gridY.map((gy, i) => (
          <g key={i}>
            <line className="curve__grid" x1={PAD.left} y1={py(gy)} x2={W - PAD.right} y2={py(gy)} />
            <text className="curve__axis" x={PAD.left - 10} y={py(gy) + 4} textAnchor="end">
              {usd(gy)}
            </text>
          </g>
        ))}
        {/* x labels */}
        {[0, Math.round(maxSupply / 2), maxSupply].map((s) => (
          <text key={s} className="curve__axis" x={px(s)} y={H - PAD.bottom + 22} textAnchor="middle">
            {s} sold
          </text>
        ))}

        {/* claimed-capacity area (grows on each buy) */}
        <path className="curve__area" d={areaPath} fill="url(#boaArea)" />
        {/* the forward curve */}
        <path className="curve__line" d={linePath} fill="none" stroke="url(#boaLine)" strokeWidth={3} />

        {/* "you are here" guide + next-fill ghost */}
        <line className="curve__guide" x1={markerX} y1={markerY} x2={markerX} y2={H - PAD.bottom} />
        {sold < maxSupply && (
          <circle className="curve__ghost" cx={px(sold + 1)} cy={py(premiumAt(sold + 1, basePremium))} r={5} />
        )}

        {/* live marker — transitions when sold changes */}
        <g className="curve__markerG" style={{ transform: `translate(${markerX}px, ${markerY}px)` }}>
          <circle r={9} className="curve__markerHalo" filter="url(#boaGlow)" />
          <circle r={5.5} className="curve__marker" />
        </g>
      </svg>

      <div className="curve__foot">
        <span>
          <b>{sold}</b> / {maxSupply} units claimed
        </span>
        <span>
          next unit <b>{usd(price ? price.nextPremium : premiumAt(sold + 1, basePremium))}</b>
        </span>
        <span className="curve__hint">↑ buy a membership to push the curve</span>
      </div>
    </div>
  );
}
