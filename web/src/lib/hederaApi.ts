// Client for the BoA × Hedera agentic-payments API (boa-hedera-service).
// LIVE-only: every value comes from the API → real Hedera testnet (HTS settlement,
// HCS audit). Configure VITE_BOA_HEDERA_API to the deployed service URL.

import { HEDERA_API } from '../config';

export const HEDERA_ENABLED = HEDERA_API !== '';

export type EmitHandlers = {
  onPrice?: (d: any) => void;
  onSettle?: (d: any) => void;
  onSign?: (d: any) => void;
  onSubmit?: (d: any) => void;
  onVerifyStart?: (d: any) => void;
  onDone: (d: any) => void;
  onError: (msg: string) => void;
};

/** Open the SSE stream for one priced+settled+anchored agent call. Returns a closer. */
export function emitReceiptStream(overrides: Record<string, string> = {}, h: EmitHandlers): () => void {
  if (!HEDERA_ENABLED) {
    h.onError('VITE_BOA_HEDERA_API not configured');
    return () => {};
  }
  const qs = new URLSearchParams(overrides).toString();
  const es = new EventSource(`${HEDERA_API}/api/receipts/emit/stream${qs ? `?${qs}` : ''}`);
  const J = (e: Event) => JSON.parse((e as MessageEvent).data);
  es.addEventListener('price', (e) => h.onPrice?.(J(e)));
  es.addEventListener('settle', (e) => h.onSettle?.(J(e)));
  es.addEventListener('sign', (e) => h.onSign?.(J(e)));
  es.addEventListener('submit', (e) => h.onSubmit?.(J(e)));
  es.addEventListener('verify_start', (e) => h.onVerifyStart?.(J(e)));
  es.addEventListener('done', (e) => {
    h.onDone(J(e));
    es.close();
  });
  es.addEventListener('error', (e) => {
    const d = (e as MessageEvent).data;
    h.onError(d ? JSON.parse(d).error : 'stream error');
    es.close();
  });
  return () => es.close();
}

export interface AuditRow {
  sequenceNumber: number;
  consensusTimestamp: string;
  receipt: any;
  hashscanUrl: string;
}

export async function fetchAuditLog(): Promise<AuditRow[]> {
  if (!HEDERA_ENABLED) return [];
  const r = await fetch(`${HEDERA_API}/api/receipts`);
  return ((await r.json())?.receipts ?? []) as AuditRow[];
}

export async function fetchHealth(): Promise<any | null> {
  if (!HEDERA_ENABLED) return null;
  try {
    return await (await fetch(`${HEDERA_API}/api/health`)).json();
  } catch {
    return null;
  }
}
