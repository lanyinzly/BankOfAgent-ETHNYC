/**
 * LIVE DEMO driver — mint an ENS name a judge names, in front of them.
 *
 *   npm run demo "ethglobal"
 *   npm run demo               # defaults to a fun label
 *
 * Takes the word, makes it collision-proof with a short random suffix, then runs
 * the real Sepolia flow: register <word>-<rand>.eth, give the agent the subname
 * agent-a.<word>-<rand>.eth, write the boa.usage digest, and read it back live.
 * Prints the Etherscan + ENS-app links to drop into the browser on stage.
 */
const raw = process.argv.slice(2).join(' ').trim() || 'bank-of-agent';
const slug = raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'boa';
const label = `${slug}-${Math.random().toString(16).slice(2, 6)}`;
process.env.PARENT_LABEL = label;
process.env.AGENT_LABEL = process.env.AGENT_LABEL || 'agent-a';

console.log('\n┌──────────────────────────────────────────────────────────────┐');
console.log('│  BoA × ENS — minting a fresh name live on Sepolia            │');
console.log('└──────────────────────────────────────────────────────────────┘');
console.log(`  judge said      : "${raw}"`);
console.log(`  minting         : ${label}.eth   (random suffix = guaranteed free)`);
console.log('  what you\'ll see :');
console.log('    1. register   → the .eth name is minted on-chain (you own it)');
console.log('    2. subname    → agent-a.<name> becomes this agent\'s identity');
console.log('    3. setText    → its boa.usage digest is written to a text record');
console.log('    4. read-back  → resolved from ENS, proving it\'s really on-chain\n');

// hand off to the real, tested Sepolia flow with our chosen label
await import('./register-and-write-sepolia.js');
