// Agent-native PRICE DISCOVERY. Each seller/tool prices per FOAMM-style bonding
// curve; soldUnits rises on every settled purchase, so demand from buyer agents
// discovers the price on-chain — permissionless, no human.
//
//   price(tokens) = basePricePer1k * (tokens/1000) * (1 + k * soldUnits)
//
// In-memory here (clearly "on-chain upgrade ready": a Quoter.sol on Arc, or the
// ERC-7527 FOAMM curve from sibling repo lanyinzly/EIP7527, holds this state).
import { ethers } from "ethers";

export interface Tool {
  id: string;
  name: string;
  kind: "LLM" | "RAG" | "data" | "compute";
  basePricePer1k: number; // USDC per 1k tokens at soldUnits=0
  k: number; // curve steepness (per sold unit)
  soldUnits: number;
}

const TOOLS: Record<string, Tool> = {
  "gpt-4o": { id: "gpt-4o", name: "Frontier LLM", kind: "LLM", basePricePer1k: 0.02, k: 0.04, soldUnits: 0 },
  "rag-search": { id: "rag-search", name: "RAG / vector search", kind: "RAG", basePricePer1k: 0.012, k: 0.05, soldUnits: 0 },
  "px-data": { id: "px-data", name: "Market data feed", kind: "data", basePricePer1k: 0.03, k: 0.03, soldUnits: 0 },
};

export function listTools(): Tool[] {
  return Object.values(TOOLS);
}
export function getTool(id: string): Tool | null {
  return TOOLS[id] ?? null;
}

/** FOAMM price for `tokens` at a given sold count (USDC, number). */
export function priceAt(t: Tool, tokens: number, soldUnits = t.soldUnits): number {
  const p = t.basePricePer1k * (tokens / 1000) * (1 + t.k * soldUnits);
  return Math.max(0.000001, +p.toFixed(6));
}

/** On-chain amount (USDC base units, 6 dp) for the current quote. */
export function priceUnits(t: Tool, tokens: number, soldUnits = t.soldUnits): bigint {
  return ethers.parseUnits(priceAt(t, tokens, soldUnits).toFixed(6), 6);
}

/** A quote + the plottable demand curve (so the UI marks the live point climbing). */
export function quote(t: Tool, tokens: number) {
  const span = Math.max(24, t.soldUnits + 12);
  const curve = Array.from({ length: span + 1 }, (_, x) => ({ x, y: priceAt(t, tokens, x) }));
  return {
    tool: t.id,
    name: t.name,
    kind: t.kind,
    maxTokens: tokens,
    priceUsdc: priceAt(t, tokens).toFixed(6),
    soldUnits: t.soldUnits,
    basePricePer1k: t.basePricePer1k,
    k: t.k,
    curve,
  };
}

/** A settled purchase advances the curve (demand discovered the price upward). */
export function recordSale(id: string): number {
  const t = TOOLS[id];
  if (t) t.soldUnits += 1;
  return t?.soldUnits ?? 0;
}
