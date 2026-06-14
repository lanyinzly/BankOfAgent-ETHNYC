// Usage metering: estimate token counts and price them in USDC.
// Token estimate is a deliberately simple ~4 chars/token heuristic — good enough
// for a stubbed meter; swap for a real tokenizer when forwarding to real models.

export interface ChatMessage {
  role: string;
  content: unknown;
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function messagesToText(messages: ChatMessage[] | undefined): string {
  if (!Array.isArray(messages)) return "";
  return messages
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")))
    .join("\n");
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function costUsdc(
  inputTokens: number,
  outputTokens: number,
  priceInputPer1k: number,
  priceOutputPer1k: number,
): number {
  const c = (inputTokens / 1000) * priceInputPer1k + (outputTokens / 1000) * priceOutputPer1k;
  // Never bill exactly 0 for a successful call — keep the curve/receipt meaningful.
  return Math.max(0.000001, round6(c));
}
