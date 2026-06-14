/**
 * Verify the deployed boa-ens-service flow on live Sepolia:
 *   POST /agents       → operator creates subname (owner=operator) + setAddr(agent) + boa.usage
 *   POST /agents/claim → operator setSubnodeOwner(node, agent)  → agent now OWNS it (self-custody)
 *
 * Asserts the records survive the ownership handoff (records are keyed by node, not owner).
 * All txs are operator-signed (the user/agent pays 0 gas), exactly like the backend.
 */
import { readFileSync, existsSync } from 'node:fs';
import {
  createPublicClient, createWalletClient, http, getAddress, keccak256, namehash, labelhash,
  toHex, parseAbi, type Address, type Hex,
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
  'function setSubnodeOwner(bytes32 node, bytes32 label, address owner)',
]);
const resolverAbi = parseAbi([
  'function setAddr(bytes32 node, address a)',
  'function setText(bytes32 node, string key, string value)',
  'function addr(bytes32 node) view returns (address)',
  'function text(bytes32 node, string key) view returns (string)',
]);

const opKey = (process.env.PRIVATE_KEY || (existsSync('.sepolia-key') ? readFileSync('.sepolia-key', 'utf8').trim() : '')) as Hex;
const operator = privateKeyToAccount(opKey);
const agent = privateKeyToAccount((process.env.AGENT_PK as Hex) || generatePrivateKey());
const rpc = process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
const op = createWalletClient({ account: operator, chain: sepolia, transport: http(rpc) });
const wait = (h: Hex) => pub.waitForTransactionReceipt({ hash: h });
const send = (functionName: string, address: Address, abi: any, args: any[]) =>
  op.writeContract({ address, abi, functionName, args, account: operator, chain: sepolia });

const ownerOf = async (node: Hex) => getAddress((await pub.readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: 'owner', args: [node] })) as Address);
const textOf = (node: Hex) => pub.readContract({ address: PUBLIC_RESOLVER, abi: resolverAbi, functionName: 'text', args: [node, 'boa.usage'] }) as Promise<string>;
const addrOf = async (node: Hex) => getAddress((await pub.readContract({ address: PUBLIC_RESOLVER, abi: resolverAbi, functionName: 'addr', args: [node] })) as Address);

async function main() {
  const label = process.env.AGENT_LABEL || `claimtest-${Math.random().toString(16).slice(2, 7)}`;
  const fullName = `${label}.${FLEET}`;
  const node = namehash(fullName);
  const usage = JSON.stringify({ agent: fullName, period: '2026-06-14', model: 'claude-opus', requests: 0, digest: keccak256(toHex(fullName)) });

  console.log('operator (fleet) :', operator.address, '\nagent (self-custody):', agent.address, '\nsubname:', fullName, '\n');
  if (await ownerOf(FLEET_NODE) !== operator.address) throw new Error('operator does not own the fleet parent');

  // ── mimic POST /agents (operator owns it, points addr at the agent, writes boa.usage) ──
  console.log('· /agents: create subname (owner=operator) + setAddr(agent) + boa.usage …');
  await wait(await send('setSubnodeRecord', ENS_REGISTRY, registryAbi, [FLEET_NODE, labelhash(label), operator.address, PUBLIC_RESOLVER, 0n]));
  await wait(await send('setAddr', PUBLIC_RESOLVER, resolverAbi, [node, agent.address]));
  await wait(await send('setText', PUBLIC_RESOLVER, resolverAbi, [node, 'boa.usage', usage]));
  const o1 = await ownerOf(node), a1 = await addrOf(node), t1 = await textOf(node);
  console.log('  owner          :', o1, o1 === operator.address ? '✓ operator (gasless, platform-managed)' : '✗');
  console.log('  addr → agent   :', a1, a1 === agent.address ? '✓' : '✗');
  console.log('  boa.usage set  :', t1 === usage ? '✓' : '✗');

  // ── mimic POST /agents/claim (hand ownership to the agent) ──
  console.log('\n· /agents/claim: setSubnodeOwner(node, agent) …');
  await wait(await send('setSubnodeOwner', ENS_REGISTRY, registryAbi, [FLEET_NODE, labelhash(label), agent.address]));
  const o2 = await ownerOf(node), a2 = await addrOf(node), t2 = await textOf(node);
  console.log('  owner          :', o2, o2 === agent.address ? '✓ AGENT owns it (self-custody)' : '✗');
  console.log('  addr survived  :', a2 === agent.address ? '✓' : '✗');
  console.log('  boa.usage kept :', t2 === usage ? '✓ records survived the handoff' : '✗');

  const pass = o1 === operator.address && a1 === agent.address && t1 === usage && o2 === agent.address && a2 === agent.address && t2 === usage;
  console.log('\nCLAIM FLOW:', pass ? 'PASS ✅' : 'FAIL ❌', ` https://sepolia.app.ens.domains/${fullName}`);
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error('claim-flow error:', e?.shortMessage || e?.message || e); process.exit(1); });
