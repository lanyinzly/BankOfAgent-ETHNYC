// Self-contained client for the AgentIdentityWidget. Talks to boa-ens-service for
// the gasless mint (backend signs on Sepolia) and re-resolves names client-side
// with viem (no private key in the browser) to prove the records are real on-chain.
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ENS_API_BASE, ENS_READ_RPC } from '../config';

export const reader = createPublicClient({ chain: sepolia, transport: http(ENS_READ_RPC) });

export type AgentWallet = { address: `0x${string}`; privateKey?: `0x${string}` };

/** Generate a fresh in-browser identity for the agent (demo-only key in localStorage). */
export function newAgentWallet(): AgentWallet {
  const privateKey = generatePrivateKey();
  return { address: privateKeyToAccount(privateKey).address, privateKey };
}

/** Use an existing injected wallet's address (no chain switch, no signing — address only). */
export async function connectInjected(): Promise<`0x${string}` | null> {
  const eth = (window as any).ethereum;
  if (!eth) return null;
  const [addr] = await eth.request({ method: 'eth_requestAccounts' });
  return (addr ?? null) as `0x${string}` | null;
}

export interface MintResult {
  ensName: string;
  address: string;
  owner?: string;
  selfCustody?: boolean;
  records: Record<string, string>;
  links: { ens: string; etherscan: string };
}

export type SseHandlers = {
  onStart?: (e: any) => void;
  onStep?: (e: any) => void;
  onResult?: (r: MintResult) => void;
  onError?: (msg: string) => void;
};

/** POST + SSE (EventSource can't POST). Mirrors boa-ens-service event names. */
export async function spawnAgent(
  body: { name: string; address: string; model?: string; description?: string },
  h: SseHandlers,
): Promise<void> {
  const res = await fetch(`${ENS_API_BASE}/agents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.body) throw new Error('no event stream');
  const rd = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await rd.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split('\n\n');
    buf = frames.pop() ?? '';
    for (const f of frames) {
      const ev = /event: (.*)/.exec(f)?.[1];
      const dt = /data: (.*)/.exec(f)?.[1];
      if (!ev || !dt) continue;
      const data = JSON.parse(dt);
      if (ev === 'start') h.onStart?.(data);
      else if (ev === 'step') h.onStep?.(data);
      else if (ev === 'result') h.onResult?.(data as MintResult);
      else if (ev === 'error') h.onError?.(data.message);
    }
  }
}

/** Hand registry ownership of the name to the agent (still 0 gas for the user). */
export async function claimOwnership(
  name: string,
  address: string,
): Promise<{ owner: string; claimTx: string; ens: string }> {
  const r = await fetch(`${ENS_API_BASE}/agents/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, address }),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || `claim failed: ${r.status}`);
  return j;
}

/** Independent, client-side re-resolution via the Universal Resolver. */
export async function resolveLive(name: string): Promise<{ address: string | null; boaUsage: string | null }> {
  const [address, boaUsage] = await Promise.all([
    reader.getEnsAddress({ name }).catch(() => null),
    reader.getEnsText({ name, key: 'boa.usage' }).catch(() => null),
  ]);
  return { address, boaUsage };
}
