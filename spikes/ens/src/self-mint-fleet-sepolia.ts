/**
 * SELF-CUSTODY fleet subname + agent self-signs its records.
 *
 * ENS rule: only the parent owner can CREATE a child. So the fleet operator
 * (backend key) creates `<label>.<FLEET>` but assigns ownership directly to the
 * AGENT wallet. From that point the agent OWNS the subname and is authorised to
 * sign its own setAddr/setText — true self-custody, while the name still lives
 * under the shared fleet registry.
 *
 *   grant  (operator signs once): registry.setSubnodeRecord(fleetNode, label, AGENT, resolver, 0)
 *   write  (AGENT signs):         resolver.setAddr(node, AGENT) ; resolver.setText(node,'boa.usage',…)
 *
 * Modes:
 *   default            -> grant, then SIMULATE the agent's setAddr/setText (free) to
 *                         prove the agent is authorised. Costs ~1 tx (the grant).
 *   SELF_BROADCAST=1   -> also fund the agent a little gas and have the AGENT actually
 *                         broadcast setAddr+setText, then read back. (needs balance)
 */
import { readFileSync, existsSync } from 'node:fs';
import {
  createPublicClient, createWalletClient, http, getAddress, keccak256, namehash, labelhash,
  toHex, parseAbi, parseEther, type Address, type Hex,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as Address;
const PUBLIC_RESOLVER = '0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5' as Address;
const FLEET = process.env.FLEET_PARENT || 'bankofagent-37d9ba.eth';
const FLEET_NODE = namehash(FLEET);

const registryAbi = parseAbi([
  'function owner(bytes32) view returns (address)',
  'function resolver(bytes32) view returns (address)',
  'function setSubnodeRecord(bytes32 node, bytes32 label, address owner, address resolver, uint64 ttl)',
]);
const resolverAbi = parseAbi([
  'function setAddr(bytes32 node, address a)',
  'function setText(bytes32 node, string key, string value)',
  'function addr(bytes32 node) view returns (address)',
  'function text(bytes32 node, string key) view returns (string)',
]);

const opKey = (process.env.PRIVATE_KEY || (existsSync('.sepolia-key') ? readFileSync('.sepolia-key', 'utf8').trim() : '')) as Hex;
const operator = privateKeyToAccount(opKey);                       // owns FLEET (parent)
const agent = privateKeyToAccount((process.env.AGENT_PK as Hex) || generatePrivateKey()); // the self-custody agent

const rpc = process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
const opWallet = createWalletClient({ account: operator, chain: sepolia, transport: http(rpc) });
const agentWallet = createWalletClient({ account: agent, chain: sepolia, transport: http(rpc) });
const wait = (hash: Hex) => pub.waitForTransactionReceipt({ hash });

async function main() {
  const label = process.env.AGENT_LABEL || `selftest-${Math.random().toString(16).slice(2, 7)}`;
  const fullName = `${label}.${FLEET}`;
  const node = namehash(fullName);
  const usage = JSON.stringify({ agent: fullName, period: '2026-06-14', model: 'claude-opus', selfCustody: true });

  console.log('fleet (parent)     :', FLEET, '\noperator (parent)  :', operator.address, '\nagent (self-custody):', agent.address);
  if (getAddress(await pub.readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: 'owner', args: [FLEET_NODE] }) as Address) !== operator.address)
    throw new Error('operator does not own the fleet parent');

  // ── GRANT: operator creates the subname but assigns ownership to the AGENT ──
  console.log(`\n· operator grants ${fullName} → owner = agent …`);
  await wait(await opWallet.writeContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: 'setSubnodeRecord', args: [FLEET_NODE, labelhash(label), agent.address, PUBLIC_RESOLVER, 0n], account: operator, chain: sepolia }));

  const owner = getAddress(await pub.readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: 'owner', args: [node] }) as Address);
  const resolver = getAddress(await pub.readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: 'resolver', args: [node] }) as Address);
  console.log('  registry.owner(node)   :', owner, owner === agent.address ? '✓ agent owns it (self-custody)' : '✗');
  console.log('  registry.resolver(node):', resolver, resolver === PUBLIC_RESOLVER ? '✓' : '✗');

  if (process.env.SELF_BROADCAST === '1') {
    // fund the agent a little gas, then the AGENT itself signs + broadcasts its records
    console.log('\n· funding agent gas, then AGENT self-signs setAddr + setText …');
    await wait(await opWallet.sendTransaction({ account: operator, chain: sepolia, to: agent.address, value: parseEther('0.0015') }));
    await wait(await agentWallet.writeContract({ address: PUBLIC_RESOLVER, abi: resolverAbi, functionName: 'setAddr', args: [node, agent.address], account: agent, chain: sepolia }));
    await wait(await agentWallet.writeContract({ address: PUBLIC_RESOLVER, abi: resolverAbi, functionName: 'setText', args: [node, 'boa.usage', usage], account: agent, chain: sepolia }));
    const back = await pub.readContract({ address: PUBLIC_RESOLVER, abi: resolverAbi, functionName: 'text', args: [node, 'boa.usage'] });
    console.log('  read-back boa.usage    :', back, back === usage ? '✓ identical' : '✗');
    console.log('\nSELF-MINT (broadcast): PASS ✅  ', `https://sepolia.app.ens.domains/${fullName}`);
  } else {
    // cheap proof: SIMULATE the agent's writes (no gas) — success == agent is authorised
    console.log('\n· simulating AGENT-signed writes (no broadcast) …');
    await pub.simulateContract({ address: PUBLIC_RESOLVER, abi: resolverAbi, functionName: 'setAddr', args: [node, agent.address], account: agent.address });
    await pub.simulateContract({ address: PUBLIC_RESOLVER, abi: resolverAbi, functionName: 'setText', args: [node, 'boa.usage', usage], account: agent.address });
    console.log('  setAddr  (as agent)    : ✓ authorised');
    console.log('  setText  (as agent)    : ✓ authorised');
    console.log('\nSELF-CUSTODY PROOF: PASS ✅  the agent owns the fleet subname and may self-sign its records.');
    console.log('(set SELF_BROADCAST=1 with a funded operator to actually broadcast the agent-signed records.)');
  }
}
main().catch((e) => { console.error('self-mint error:', e?.shortMessage || e?.message || e); process.exit(1); });
