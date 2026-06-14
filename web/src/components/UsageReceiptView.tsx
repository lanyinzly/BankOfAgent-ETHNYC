import { usd } from '../lib/foamm';
import type { UsageReceipt } from '../types';

export default function UsageReceiptView({ receipt }: { receipt: UsageReceipt }) {
  return (
    <div className="receipt">
      <div className="receipt__head">
        <span className="receipt__tag">usage receipt · x-boa-usage</span>
        <span className="receipt__model">{receipt.model}</span>
      </div>
      <div className="receipt__grid">
        <Metric label="prompt" value={`${receipt.prompt_tokens} tok`} />
        <Metric label="completion" value={`${receipt.completion_tokens} tok`} />
        <Metric label="total" value={`${receipt.total_tokens} tok`} strong />
        <Metric label="cost" value={usd(receipt.cost, 4)} strong accent />
        <Metric label="price before" value={`${usd(receipt.price_before, 4)}/1k`} />
        <Metric
          label="price after"
          value={`${usd(receipt.price_after, 4)}/1k`}
          up={receipt.price_after > receipt.price_before}
        />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  strong,
  accent,
  up,
}: {
  label: string;
  value: string;
  strong?: boolean;
  accent?: boolean;
  up?: boolean;
}) {
  return (
    <div className="metric">
      <div className="metric__label">{label}</div>
      <div
        className={`metric__value ${strong ? 'metric__value--strong' : ''} ${
          accent ? 'metric__value--accent' : ''
        } ${up ? 'metric__value--up' : ''}`}
      >
        {value}
        {up && <span className="metric__arrow"> ▲</span>}
      </div>
    </div>
  );
}
