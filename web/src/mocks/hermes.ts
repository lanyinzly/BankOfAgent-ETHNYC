// ─────────────────────────────────────────────────────────────────────────────
// A tiny stand-in "model" for the mock relay. It produces plausible, on-topic
// completions so the demo shows real returned content + a real usage receipt,
// without any external model dependency. (Named for Hermes — the OpenAI-compatible
// agent used as the "connect your agent" example.)
// ─────────────────────────────────────────────────────────────────────────────

/** Rough token estimate — ~4 chars/token, the usual OpenAI heuristic. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

const CANNED: Array<{ test: RegExp; reply: string }> = [
  {
    test: /price|cost|hedge|forward|premium|curve|futures?/i,
    reply:
      "On Bank of Agent, forward inference is priced by FOAMM: premium = basePremium + sold/100. " +
      "Right now each new unit of claimed capacity lifts the premium ~1%, so the curve you see is the " +
      "market's live forecast of compute scarcity. To hedge a long task, mint vouchers today and lock " +
      "the strike; resell or redeem them later as demand moves the curve.",
  },
  {
    test: /voucher|redeem|transfer|membership|erc.?7527/i,
    reply:
      "An ERC-7527 voucher is a transferable claim on future inference at terms struck today. Mint it, " +
      "hand it to another agent, and they redeem it into quota — a priced claim on future compute changing " +
      "hands before anyone consumes it. That handoff is the primitive the whole futures thesis is built on.",
  },
  {
    test: /who|what is|explain|boa|bank of agent/i,
    reply:
      "Bank of Agent is an agent-native exchange that turns AI inference into a tradable asset. It gives " +
      "compute the four things every real market has: a unit of account (USDC quota), a spot price " +
      "(metered per call), a forward curve (FOAMM-priced ERC-7527 vouchers), and verifiable delivery " +
      "(usage digests synced to ENS).",
  },
  {
    test: /code|function|write|build|implement/i,
    reply:
      "Point any OpenAI-compatible client at the BoA relay and you're trading compute:\n\n" +
      "    client = OpenAI(base_url='https://boa-newapi-production.up.railway.app/v1', api_key='sk-...')\n" +
      "    client.chat.completions.create(model='anthropic/claude-opus-4-6', messages=[...])\n\n" +
      "Every call is metered against your quota and the receipt rides back on the x-boa-usage header.",
  },
];

export function generateCompletion(prompt: string, agent: string): string {
  const hit = CANNED.find((c) => c.test.test(prompt));
  if (hit) return hit.reply;
  // Generic, on-brand fallback that still reflects the prompt.
  const topic = prompt.trim().replace(/\s+/g, ' ').slice(0, 120) || 'your request';
  return (
    `Acknowledged from ${agent}. Routed "${topic}" through the BoA gateway and drew the cost from your ` +
    `metered quota. The usage receipt for this call (tokens, cost, and the spot price before/after) is ` +
    `attached on the x-boa-usage header — that is your verifiable proof of delivery.`
  );
}
