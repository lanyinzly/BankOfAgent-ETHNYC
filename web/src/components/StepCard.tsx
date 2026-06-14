import type { ReactNode } from 'react';

export type StepStatus = 'locked' | 'ready' | 'done';

interface Props {
  n: number;
  title: string;
  status: StepStatus;
  hint?: string;
  highlight?: boolean;
  children: ReactNode;
}

export default function StepCard({ n, title, status, hint, highlight, children }: Props) {
  return (
    <section id={`step-${n}`} className={`card step step--${status} ${highlight ? 'step--hl' : ''}`}>
      <h2 className="card__title">
        <span className={`card__num card__num--${status}`}>{status === 'done' ? '✓' : n}</span>
        {title}
      </h2>
      {hint && <p className="step__hint">{hint}</p>}
      <div className={status === 'locked' ? 'step__body step__body--locked' : 'step__body'}>{children}</div>
    </section>
  );
}
