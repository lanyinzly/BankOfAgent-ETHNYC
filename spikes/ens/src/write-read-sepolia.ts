/**
 * REAL TESTNET path — same flow as write-read-local.ts, but against live ENS on
 * Sepolia. Kept separate because it needs a funded key + a parent name you own,
 * which the spike sandbox does not have (no faucet / no key). Run it yourself:
 *
 *   # read-only preflight (no key needed) — verifies Sepolia ENS is reachable
 *   npx tsx src/write-read-sepolia.ts
 *
 *   # full write + read-back (needs Sepolia ETH + an UNWRAPPED parent you own)
 *   SEPOLIA_RPC_URL=https://… \
 *   PRIVATE_KEY=0x…            \
 *   PARENT_NAME=yourname.eth   \
 *   AGENT_LABEL=agent-a        \
 *   npx tsx src/write-read-sepolia.ts
 *
 * It creates agent-a.<PARENT_NAME>, points it at the agent address, writes the
 * boa.usage text record, then reads everything back via the viem ENS actions.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  getContract,
  keccak256,
  namehash,
  labelhash,
  toHex,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

// Canonical Sepolia ENS deployments (from @ensdomains/ens-contracts/deployments/sepolia)
const ENS_REGISTRY = (process.env.ENS_REGISTRY || '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e') as Address;
const PUBLIC_RESOLVER = (process.env.PUBLIC_RESOLVER || '0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5') as Address;

const registryAbi = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'resolver', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'setSubnodeRecord', stateMutability: 'nonpayable', inputs: [
    { name: 'node', type: 'bytes32' }, { name: 'label', type: 'bytes32' }, { name: 'owner', type: 'address' }, { name: 'resolver', type: 'address' }, { name: 'ttl', type: 'uint64' },
  ], outputs: [] },
] as const;

const resolverAbi = [
  { type: 'function', name: 'setAddr', stateMutability: 'nonpayable', inputs: [{ name: 'node', type: 'bytes32' }, { name: 'a', type: 'address' }], outputs: [] },
  { type: 'function', name: 'setText', stateMutability: 'nonpayable', inputs: [{ name: 'node', type: 'bytes32' }, { name: 'key', type: 'string' }, { name: 'value', type: 'string' }], outputs: [] },
] as const;

function buildUsageRecord(fullName: string) {
  const usage = { agent: fullName, period: '2026-06-13', model: 'claude-opus', requests: 97, tokensIn: 120_443, tokensOut: 88_210 };
  const digest = keccak256(toHex(JSON.stringify(usage)));
  return JSON.stringify({ ...usage, digest });
}

async function preflight() {
  const rpc = process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
  const client = createPublicClient({ chain: sepolia, transport: http(rpc) });
  console.log('--- Sepolia ENS preflight (read-only) ---');
  console.log('rpc                :', rpc);
  const chainId = await client.getChainId();
  const regCode = await client.getCode({ address: ENS_REGISTRY });
  const resCode = await client.getCode({ address: PUBLIC_RESOLVER });
  console.log('chainId            :', chainId, chainId === 11155111 ? '✓' : '✗ not Sepolia');
  console.log('ENS registry       :', ENS_REGISTRY, regCode && regCode !== '0x' ? '✓ has code' : '✗ no code');
  console.log('PublicResolver     :', PUBLIC_RESOLVER, resCode && resCode !== '0x' ? '✓ has code' : '✗ no code');
  if (process.env.SEPOLIA_NAME) {
    const addr = await client.getEnsAddress({ name: process.env.SEPOLIA_NAME });
    console.log(`resolve ${process.env.SEPOLIA_NAME} :`, addr);
  }
  const ok = chainId === 11155111 && !!regCode && regCode !== '0x' && !!resCode && resCode !== '0x';
  console.log('\nPREFLIGHT:', ok ? 'OK ✅ (Sepolia ENS reachable; set PRIVATE_KEY+PARENT_NAME for the full write)' : 'FAIL ❌');
  return ok;
}

async function fullRun() {
  const rpc = process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
  const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const parentName = process.env.PARENT_NAME!;
  const subLabel = process.env.AGENT_LABEL || 'agent-a';
  const fullName = `${subLabel}.${parentName}`;
  const agentAddress = getAddress(process.env.AGENT_ADDRESS || account.address);
  const textValue = buildUsageRecord(fullName);

  const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });

  // guard: the key must own the parent name, and it must not be wrapped
  const parentOwner = await pub.readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: 'owner', args: [namehash(parentName)] });
  if (getAddress(parentOwner as Address) !== account.address) {
    throw new Error(`PARENT_NAME ${parentName} is owned by ${parentOwner}, not your key ${account.address}. Use a parent you own (unwrapped), or transfer it first.`);
  }

  const registry = getContract({ address: ENS_REGISTRY, abi: registryAbi, client: wallet });
  const resolver = getContract({ address: PUBLIC_RESOLVER, abi: resolverAbi, client: wallet });
  const node = namehash(fullName);

  console.log(`· creating subname ${fullName} (resolver ${PUBLIC_RESOLVER}) …`);
  await pub.waitForTransactionReceipt({ hash: await registry.write.setSubnodeRecord([namehash(parentName), labelhash(subLabel), account.address, PUBLIC_RESOLVER, 0n]) });
  console.log(`· setAddr → ${agentAddress} …`);
  await pub.waitForTransactionReceipt({ hash: await resolver.write.setAddr([node, agentAddress]) });
  console.log('· setText boa.usage …');
  await pub.waitForTransactionReceipt({ hash: await resolver.write.setText([node, 'boa.usage', textValue]) });

  // read back via the high-level viem ENS actions (universal resolver)
  const resolvedAddress = await pub.getEnsAddress({ name: fullName });
  const textReadBack = await pub.getEnsText({ name: fullName, key: 'boa.usage' });

  const addrOk = resolvedAddress && getAddress(resolvedAddress) === agentAddress;
  const textOk = textReadBack === textValue;
  console.log('\n--- Sepolia ENS write/read-back ---');
  console.log('subname            :', fullName);
  console.log('resolved → address :', resolvedAddress, addrOk ? '✓' : '✗ MISMATCH');
  console.log('text["boa.usage"]  :', textReadBack);
  console.log('read-back matches  :', textOk ? '✓' : '✗ MISMATCH');
  console.log('\nSEPOLIA RESULT:', addrOk && textOk ? 'PASS ✅' : 'FAIL ❌');
  return Boolean(addrOk && textOk);
}

async function main() {
  if (process.env.PRIVATE_KEY && process.env.PARENT_NAME) {
    const ok = await fullRun();
    process.exit(ok ? 0 : 1);
  } else {
    const ok = await preflight();
    process.exit(ok ? 0 : 1);
  }
}

main().catch((e) => {
  console.error('Sepolia spike error:', e?.shortMessage || e?.message || e);
  process.exit(1);
});
