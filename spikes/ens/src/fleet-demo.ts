/**
 * FLEET demo data + discovery proof for the frontend.
 *
 *   1. register ONE fleet root  bankofagent-<rand>.eth   (the agent fleet's ENS registry)
 *   2. mint a subname per agent  <agent>.bankofagent-<rand>.eth  + write metadata text records
 *   3. DISCOVER the fleet by reading ENS registry NewOwner events (no hard-coded list)
 *
 * Produces fleet-result.json — point the frontend's FLEET_PARENT at it.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import {
  createPublicClient, createWalletClient, http, getAddress, keccak256, namehash, labelhash,
  toHex, concat, parseAbi, parseAbiItem, type Address, type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const require = createRequire(import.meta.url);
const controllerArtifact = require('@ensdomains/ens-contracts/deployments/sepolia/ETHRegistrarController.json');

const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as Address;
const PUBLIC_RESOLVER = '0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5' as Address;
const CONTROLLER = getAddress('0xdf60C561Ca35AD3C89D24BbA854654b1c3477078');
const Z32 = `0x${'00'.repeat(32)}` as Hex;

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
const newOwner = parseAbiItem('event NewOwner(bytes32 indexed node, bytes32 indexed label, address owner)');

const key = (process.env.PRIVATE_KEY || (existsSync('.sepolia-key') ? readFileSync('.sepolia-key', 'utf8').trim() : '')) as Hex;
const account = privateKeyToAccount(key);
const rpc = process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });
const wait = (hash: Hex) => pub.waitForTransactionReceipt({ hash });
// let viem auto-estimate fees (Sepolia base fee is volatile; a fixed cap breaks
// when it spikes). Just keep the key funded enough for the current fee level.
const FEES = {} as const;

// each agent gets its own deterministic identity address (no hard-coding)
const agentAddr = (fullName: string) => privateKeyToAccount(keccak256(toHex(`boa-agent:${fullName}`))).address;
const usageDigest = (fullName: string, model: string) => {
  const usage = { agent: fullName, period: '2026-06-14', model, requests: 50 + (fullName.length * 7) % 400, tokensIn: 1000 * (fullName.length % 9 + 1) };
  return JSON.stringify({ ...usage, digest: keccak256(toHex(JSON.stringify(usage))) });
};

async function main() {
  const fleetLabel = process.env.FLEET_LABEL || `bankofagent-${Math.random().toString(16).slice(2, 8)}`;
  const fleetName = `${fleetLabel}.eth`;
  const fleetNode = namehash(fleetName);
  console.log('fleet root (to mint):', fleetName, '\naccount:', account.address, '\nbalance:', Number(await pub.getBalance({ address: account.address })) / 1e18, 'ETH\n');

  // 1. register the fleet root (idempotent: skip if we already own it)
  const head = await pub.getBlockNumber();
  let fromBlock = head > 50_000n ? head - 50_000n : 0n;
  const existingOwner = await pub.readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: 'owner', args: [fleetNode] }) as Address;
  if (getAddress(existingOwner) === account.address) {
    console.log('· fleet root already owned — skipping registration\n');
  } else {
    console.log('· registering fleet root …');
    const regHash = await wallet.writeContract({ address: CONTROLLER, abi: controllerArtifact.abi, functionName: 'register',
      args: [{ label: fleetLabel, owner: account.address, duration: 31_536_000n, secret: Z32, resolver: PUBLIC_RESOLVER, data: [], reverseRecord: 0, referrer: Z32 }], value: 0n, account, chain: sepolia, ...FEES });
    const regRcpt = await wait(regHash);
    fromBlock = regRcpt.blockNumber;
    console.log('  registered at block', regRcpt.blockNumber, '\n');
  }

  // 2. mint an agent subname per fleet member, with metadata text records
  const agents = [
    { label: 'researcher', model: 'claude-opus', desc: 'Reads papers, drafts syntheses.' },
    { label: 'trader', model: 'claude-sonnet', desc: 'Quotes and settles compute forwards.' },
    { label: 'oracle', model: 'claude-haiku', desc: 'Answers pricing queries on demand.' },
  ];
  for (const a of agents) {
    const fullName = `${a.label}.${fleetName}`;
    const node = namehash(fullName);
    const addr = agentAddr(fullName);
    console.log(`· spawning ${fullName} → ${addr}`);
    await wait(await wallet.writeContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: 'setSubnodeRecord', args: [fleetNode, labelhash(a.label), account.address, PUBLIC_RESOLVER, 0n], account, chain: sepolia, ...FEES }));
    await wait(await wallet.writeContract({ address: PUBLIC_RESOLVER, abi: resolverAbi, functionName: 'setAddr', args: [node, addr], account, chain: sepolia, ...FEES }));
    await wait(await wallet.writeContract({ address: PUBLIC_RESOLVER, abi: resolverAbi, functionName: 'setText', args: [node, 'boa.usage', usageDigest(fullName, a.model)], account, chain: sepolia, ...FEES }));
    await wait(await wallet.writeContract({ address: PUBLIC_RESOLVER, abi: resolverAbi, functionName: 'setText', args: [node, 'description', a.desc], account, chain: sepolia, ...FEES }));
    await wait(await wallet.writeContract({ address: PUBLIC_RESOLVER, abi: resolverAbi, functionName: 'setText', args: [node, 'avatar', `https://api.dicebear.com/9.x/bottts/svg?seed=${a.label}`], account, chain: sepolia, ...FEES }));
  }

  // 3. DISCOVER the fleet purely from on-chain ENS registry events (no hard-coded list)
  console.log('\n=== DISCOVERY (reading ENS NewOwner events for the fleet node) ===');
  const logs = await pub.getLogs({ address: ENS_REGISTRY, event: newOwner, args: { node: fleetNode }, fromBlock, toBlock: 'latest' });
  const discovered: any[] = [];
  for (const l of logs) {
    const childNode = keccak256(concat([fleetNode, l.args.label as Hex]));
    const res = await pub.readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: 'resolver', args: [childNode] }) as Address;
    if (res === '0x0000000000000000000000000000000000000000') continue;
    const addr = await pub.readContract({ address: res, abi: resolverAbi, functionName: 'addr', args: [childNode] });
    const usage = await pub.readContract({ address: res, abi: resolverAbi, functionName: 'text', args: [childNode, 'boa.usage'] });
    const desc = await pub.readContract({ address: res, abi: resolverAbi, functionName: 'text', args: [childNode, 'description'] });
    const name = JSON.parse(usage as string).agent;
    discovered.push({ name, address: addr, description: desc, boaUsage: usage });
    console.log(`  • ${name}  →  ${addr}\n      ${desc}`);
  }

  writeFileSync('fleet-result.json', JSON.stringify({ fleetName, fleetNode, ensApp: `https://sepolia.app.ens.domains/${fleetName}`, agents: discovered }, null, 2));
  console.log('\nsaved fleet-result.json  •  ENS app:', `https://sepolia.app.ens.domains/${fleetName}`);
}
main().catch((e) => { console.error('fleet-demo error:', e?.shortMessage || e?.message || e); process.exit(1); });
