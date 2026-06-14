// Client for the BoA × Arc agent-economy API (boa-arc-service). LIVE Arc testnet.
import { ARC_API } from '../config';

export const ARC_ENABLED = ARC_API !== '';

export interface Tool {
  id: string;
  name: string;
  kind: string;
  basePricePer1k: number;
  soldUnits: number;
}
export interface Quote {
  tool: string;
  name: string;
  kind: string;
  maxTokens: number;
  priceUsdc: string;
  soldUnits: number;
  basePricePer1k: number;
  curve: { x: number; y: number }[];
}
export interface Balances {
  chainId: number;
  explorer: string;
  buyer: { address: string | null; usdc: string; link: string | null };
  seller: { address: string | null; usdc: string; link: string | null };
}
export interface BuyStep {
  k: string;
  label: string;
  priceUsdc?: string;
  txHash?: string;
  explorerUrl?: string;
  result?: any;
  soldUnitsBefore?: number;
  soldUnitsAfter?: number;
  newPriceUsdc?: string;
  maxTokens?: number;
}
export interface BuyResult {
  tool: string;
  steps: BuyStep[];
  paidUsdc: string;
  txHash: string;
  explorerUrl: string;
  balances: { buyerBefore: string; buyerAfter: string; sellerBefore: string; sellerAfter: string };
}

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${ARC_API}${path}`, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as any)?.error || `${r.status} ${r.statusText}`);
  return data as T;
}

export const arc = {
  health: () => j<any>('/health'),
  tools: () => j<Tool[]>('/api/tools'),
  price: (tool: string, maxTokens: number) => j<Quote>(`/api/price?tool=${encodeURIComponent(tool)}&maxTokens=${maxTokens}`),
  balances: () => j<Balances>('/api/balances'),
  buy: (body: { tool: string; prompt: string; maxTokens: number }) =>
    j<BuyResult>('/api/agent/buy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  settle: (amount = '1') =>
    j<any>('/api/settle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount }) }),
};
