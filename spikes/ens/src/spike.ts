/**
 * One-command go/no-go gate for the BoA ENS rail.  `npm run spike`
 *
 *   [1] LOCAL  — deploy real ENS contracts, create a subname, write+read-back a
 *                boa.usage text record. THIS is the gate (DoD). Must PASS.
 *   [2] LIVE   — resolve a real name + read a text record on mainnet ENS (bonus,
 *                non-fatal: proves the same viem path reaches production ENS).
 *   [3] STATIC — show the offline fallback the demo uses if the RPC is down.
 */
import { runLocal } from './write-read-local.js';
import { runLive } from './resolve-live.js';
import { resolveStatic, getStaticText } from './static-map.js';

function hr(title: string) {
  console.log(`\n${'═'.repeat(64)}\n${title}\n${'═'.repeat(64)}`);
}

async function main() {
  let gatePass = false;

  // [1] LOCAL — the actual gate -------------------------------------------------
  hr('[1] LOCAL ENS write + read-back  (the gate / DoD)');
  try {
    const r = await runLocal((s) => console.log('  ' + s));
    console.log('');
    console.log('  subname              :', r.fullName);
    console.log('  resolved → address   :', r.resolvedAddress, r.resolvedAddress === r.expectedAddress ? '✓' : '✗ MISMATCH');
    console.log('  text key             :', r.textKey);
    console.log('  text read-back       :', r.textReadBack);
    console.log('  read-back == written :', r.textReadBack === r.textWritten ? '✓ identical' : '✗ MISMATCH');
    console.log('  (registry/resolver   :', `${r.registry} / ${r.resolver})`);
    gatePass = r.pass;
  } catch (e) {
    console.error('  LOCAL spike threw:', e);
    gatePass = false;
  }

  // [2] LIVE — bonus, never fails the gate -------------------------------------
  hr('[2] LIVE ENS resolution on mainnet  (bonus, non-fatal)');
  const live = await runLive((s) => console.log('  ' + s));
  if (live.ok) {
    console.log('');
    console.log('  name                 :', live.name);
    console.log('  resolved → address   :', live.resolvedAddress);
    console.log(`  text["${live.textKey}"]       :`, live.textValue);
    console.log('  status               : OK ✓  (viem ENS path reaches live mainnet)');
  } else {
    console.log('  status               : DEGRADED — RPC unavailable, fall back to static map');
    console.log('  error                :', live.error);
  }

  // [3] STATIC — the demo-day fallback -----------------------------------------
  hr('[3] STATIC fallback map  (used live if RPC is down)');
  const demoName = 'agent-a.boa-demo.eth';
  console.log('  name                 :', demoName);
  console.log('  resolved → address   :', resolveStatic(demoName));
  console.log('  text["boa.usage"]    :', getStaticText(demoName, 'boa.usage'));
  console.log('  status               : OK ✓  (offline, zero network)');

  // verdict ---------------------------------------------------------------------
  hr('VERDICT');
  console.log('  [1] LOCAL write+read-back (gate) :', gatePass ? 'PASS ✅' : 'FAIL ❌');
  console.log('  [2] LIVE mainnet resolution      :', live.ok ? 'OK ✅' : 'DEGRADED ⚠️  (fallback ready)');
  console.log('  [3] STATIC fallback              : OK ✅');
  console.log('');
  console.log('  ENS RAIL GATE:', gatePass ? 'PASS ✅  — go' : 'FAIL ❌  — no-go (use static fallback for demo)');
  console.log('');
  process.exit(gatePass ? 0 : 1);
}

main();
