/**
 * LIVE sanity check — prove the *same viem code path* reaches real ENS infra.
 *
 * The local proof (write-read-local.ts) is the authoritative write+read-back
 * demonstration. This script additionally confirms that the high-level viem ENS
 * actions resolve a real name and read a real text record against live mainnet
 * ENS, so we know the plumbing works end-to-end against production contracts.
 *
 * Network-dependent: if the RPC is unreachable this returns ok=false rather than
 * throwing, so the orchestrator can degrade gracefully to the static fallback.
 */
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

export type LiveResult = {
  ok: boolean;
  chain: string;
  name: string;
  resolvedAddress: string | null;
  textKey: string;
  textValue: string | null;
  error?: string;
};

export async function runLive(log: (s: string) => void = console.log): Promise<LiveResult> {
  const rpc = process.env.MAINNET_RPC_URL || 'https://ethereum-rpc.publicnode.com';
  const name = process.env.LIVE_NAME || 'vitalik.eth';
  const textKey = process.env.LIVE_TEXT_KEY || 'avatar';

  const client = createPublicClient({ chain: mainnet, transport: http(rpc) });

  try {
    log(`· resolving ${name} against live mainnet ENS (${rpc}) …`);
    const resolvedAddress = await client.getEnsAddress({ name });
    const textValue = await client.getEnsText({ name, key: textKey });
    return {
      ok: Boolean(resolvedAddress),
      chain: 'mainnet',
      name,
      resolvedAddress: resolvedAddress ?? null,
      textKey,
      textValue: textValue ?? null,
    };
  } catch (e: any) {
    return {
      ok: false,
      chain: 'mainnet',
      name,
      resolvedAddress: null,
      textKey,
      textValue: null,
      error: e?.shortMessage || e?.message || String(e),
    };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runLive().then((r) => {
    console.log('\n--- LIVE ENS resolution (mainnet) ---');
    if (!r.ok) {
      console.log('status             : DEGRADED (network/RPC unavailable) — use static fallback');
      console.log('error              :', r.error);
      process.exit(0); // non-fatal: live read is a bonus, not the gate
    }
    console.log('name               :', r.name);
    console.log('resolved → address :', r.resolvedAddress);
    console.log(`text["${r.textKey}"]     :`, r.textValue);
    console.log('\nLIVE READ: OK ✅');
    process.exit(0);
  });
}
