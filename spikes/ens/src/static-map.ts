/**
 * FALLBACK — static identity map (ENS name -> address + records) for when the
 * ENS RPC is unreachable on demo day. Same shape the on-chain rail exposes, so
 * the rest of BoA can call resolveStatic()/getStaticText() with zero network.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAP_PATH = join(__dirname, '..', 'identity-map.json');

export type IdentityRecord = {
  address: `0x${string}`;
  records?: Record<string, string>;
};

export function loadIdentityMap(): Record<string, IdentityRecord> {
  const raw = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
  return raw.agents as Record<string, IdentityRecord>;
}

/** Resolve an ENS name -> address from the static mirror. Throws if unknown. */
export function resolveStatic(name: string): `0x${string}` {
  const rec = loadIdentityMap()[name];
  if (!rec) throw new Error(`no static identity for "${name}"`);
  return rec.address;
}

/** Read a text record (e.g. "boa.usage") from the static mirror. */
export function getStaticText(name: string, key: string): string | undefined {
  return loadIdentityMap()[name]?.records?.[key];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const name = process.env.STATIC_NAME || 'agent-a.boa-demo.eth';
  console.log('\n--- STATIC fallback resolution (no network) ---');
  console.log('name               :', name);
  console.log('resolved → address :', resolveStatic(name));
  console.log('text["boa.usage"]  :', getStaticText(name, 'boa.usage'));
  console.log('\nFALLBACK: OK ✅');
}
