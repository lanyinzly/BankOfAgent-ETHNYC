// A fixed, GSAP-animated banner that narrates the guided demo — it tells the user
// exactly what's happening at each step while the loop auto-advances and scrolls.
import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap, prefersReducedMotion } from '../lib/gsap';
import './guidedNarration.css';

interface Props {
  active: boolean;
  step: number | null;
  total: number;
  text: string | null;
}

export default function GuidedNarration({ active, step, total, text }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLParagraphElement>(null);

  // animate the text whenever the step changes
  useGSAP(
    () => {
      if (prefersReducedMotion || !line.current || !active) return;
      gsap.fromTo(line.current, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' });
    },
    { dependencies: [text, active], scope: root },
  );

  return (
    <div ref={root} className={`gnar ${active && text ? 'gnar--on' : ''}`} aria-live="polite">
      <div className="gnar__inner">
        <span className="gnar__badge">{step && step <= total ? `STEP ${step} / ${total}` : 'DEMO'}</span>
        <p ref={line} className="gnar__text">
          {text}
        </p>
      </div>
      <div className="gnar__track">
        <div className="gnar__fill" style={{ width: `${step ? Math.min(100, (step / total) * 100) : 0}%` }} />
      </div>
    </div>
  );
}
