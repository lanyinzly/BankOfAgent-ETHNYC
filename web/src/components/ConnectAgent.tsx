// ─────────────────────────────────────────────────────────────────────────────
// "Connect your agent" — shows that any OpenAI-compatible agent (here: Hermes)
// joins BoA by pointing its base_url at our /v1 and using its ENS as the key.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import CodeBlock from './CodeBlock';
import { AGENT_A, RELAY_DISPLAY_URL } from '../config';

const V1 = `${RELAY_DISPLAY_URL}/v1`;

const PYTHON = `# Hermes (or any OpenAI-compatible agent) → Bank of Agent.
# The ONLY change is base_url + your agent's ENS as the key.
from openai import OpenAI

hermes = OpenAI(
    base_url="${V1}",        # ← the BoA relay /v1
    api_key="${AGENT_A}",        # ← your agent's ENS (or key)
)

resp = hermes.chat.completions.create(
    model="boa-router/auto",                  # BoA routes across modalities
    messages=[{"role": "user", "content": "Hedge my Q3 inference cost."}],
)
print(resp.choices[0].message.content)
# Metering receipt (tokens, cost, price_before/after) → 'x-boa-usage' header.`;

const TS = `// Hermes agent in TypeScript → Bank of Agent.
import OpenAI from "openai";

const hermes = new OpenAI({
  baseURL: "${V1}", // ← the BoA relay /v1
  apiKey: "${AGENT_A}",     // ← your agent's ENS (or key)
});

const r = await hermes.chat.completions.create({
  model: "boa-router/auto",
  messages: [{ role: "user", content: "Price 1M tokens of forward inference." }],
});
console.log(r.choices[0].message.content);
// Read r.response.headers.get("x-boa-usage") for the metering receipt.`;

const CURL = `# Raw HTTP — works from any language or agent runtime.
curl ${V1}/chat/completions \\
  -H "Authorization: Bearer ${AGENT_A}" \\
  -H "Content-Type: application/json" \\
  -d '{
        "model": "boa-router/auto",
        "messages": [{"role":"user","content":"What is Bank of Agent?"}]
      }' -i
# -i prints headers so you can see x-boa-usage (tokens, cost, price_before/after).`;

const TABS: Array<{ id: string; label: string; lang: string; code: string }> = [
  { id: 'py', label: 'Python', lang: 'python', code: PYTHON },
  { id: 'ts', label: 'TypeScript', lang: 'typescript', code: TS },
  { id: 'curl', label: 'cURL', lang: 'bash', code: CURL },
];

export default function ConnectAgent() {
  const [tab, setTab] = useState('py');
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <section className="connect card">
      <h2 className="card__title">
        <span className="card__num">∞</span> Connect your agent
      </h2>
      <p className="connect__lead">
        BoA speaks the OpenAI API. Any compliant agent joins the exchange by pointing its{' '}
        <code>base_url</code> at <code>{V1}</code> and authenticating with its ENS. Below: the
        Hermes agent, connected in one line.
      </p>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab ${t.id === tab ? 'tab--on' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <CodeBlock code={active.code} lang={active.lang} />
    </section>
  );
}
