/**
 * LIVE SEPOLIA — full ENS rail on a real testnet, funds-in-the-loop.
 *
 *   register  boa-spike-<rand>.eth            (live ETHRegistrarController, single-step)
 *   create    agent-a.boa-spike-<rand>.eth    (ENS registry setSubnodeRecord -> PublicResolver)
 *   write     setAddr + setText("boa.usage", <usage digest JSON>)
 *   read-back resolve subname -> address, read boa.usage, assert identical
 *
 * NOTE: Sepolia ENS is mid-migration to ENSv2. The controller address published
 * in @ensdomains/ens-contracts AND on docs.ens.domains (0xfb3c…) has been REMOVED
 * as a registrar controller. The actually-active controller (discovered on-chain
 * from recent NameRegistered txs) is CONTROLLER below: a simplified controller
 * with no commit/reveal, value 0, names owned directly (unwrapped) by the
 * registrant. See README "Gotcha" section.
 *
 * Key: spikes/ens/.sepolia-key (generated locally, gitignored) or PRIVATE_KEY env.
 * Run:  npm run sepolia:full
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  keccak256,
  namehash,
  labelhash,
  toHex,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const require = createRequire(import.meta.url);
const controllerArtifact = require('@ensdomains/ens-contracts/deployments/sepolia/ETHRegistrarController.json');

// Canonical Sepolia ENS addresses
const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as Address;
const PUBLIC_RESOLVER = (process.env.PUBLIC_RESOLVER || '0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5') as Address;
// Live, currently-active controller (discovered on-chain; the package/docs one is removed)
const CONTROLLER = getAddress(process.env.SEPOLIA_CONTROLLER || '0xdf60C561Ca35AD3C89D24BbA854654b1c3477078');
const ZERO_BYTES32 = `0x${'00'.repeat(32)}` as Hex;

const registryAbi = parseAbi([
  'function owner(bytes32 node) view returns (address)',
  'function resolver(bytes32 node) view returns (address)',
  'function setSubnodeRecord(bytes32 node, bytes32 label, address owner, address resolver, uint64 ttl)',
]);
const resolverAbi = parseAbi([
  'function setAddr(bytes32 node, address a)',
  'function setText(bytes32 node, string key, string value)',
  'function addr(bytes32 node) view returns (address)',
  'function text(bytes32 node, string key) view returns (string)',
]);

function loadKey(): Hex {
  if (process.env.PRIVATE_KEY) return process.env.PRIVATE_KEY as Hex;
  if (existsSync('.sepolia-key')) return readFileSync('.sepolia-key', 'utf8').trim() as Hex;
  throw new Error('No key: set PRIVATE_KEY or create spikes/ens/.sepolia-key');
}

function buildUsageRecord(fullName: string) {
  const usage = { agent: fullName, period: '2026-06-13', model: 'claude-opus', requests: 97, tokensIn: 120_443, tokensOut: 88_210 };
  const digest = keccak256(toHex(JSON.stringify(usage)));
  return JSON.stringify({ ...usage, digest });
}

async function main() {
  const rpc = process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
  const account = privateKeyToAccount(loadKey());
  const agentAddress = getAddress(process.env.AGENT_ADDRESS || '0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
  const subLabel = process.env.AGENT_LABEL || 'agent-a';
  const label = process.env.PARENT_LABEL || `boa-spike-${Math.random().toString(16).slice(2, 10)}`;
  const parentName = `${label}.eth`;
  const fullName = `${subLabel}.${parentName}`;

  const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });
  const waitFor = (hash: Hex) => pub.waitForTransactionReceipt({ hash });

  console.log('account            :', account.address);
  console.log('controller (live)  :', CONTROLLER);
  console.log('parent (to mint)   :', parentName);
  console.log('subname (target)   :', fullName);

  const balance = await pub.getBalance({ address: account.address });
  console.log('balance            :', `${Number(balance) / 1e18} ETH`);
  if (balance === 0n) {
    console.log('\n⏳ NOT FUNDED. Send Sepolia ETH to', account.address, 'then run `npm run sepolia:full`.');
    process.exit(2);
  }

  // --- 1. register the parent name (single-step, value 0, unwrapped) ----------
  const registration = {
    label,
    owner: account.address,
    duration: 31_536_000n, // 1 year
    secret: ZERO_BYTES32,
    resolver: PUBLIC_RESOLVER,
    data: [] as Hex[],
    reverseRecord: 0,
    referrer: ZERO_BYTES32,
  };
  console.log('\n· register (single-step) …');
  const regHash = await wallet.writeContract({ address: CONTROLLER, abi: controllerArtifact.abi, functionName: 'register', args: [registration], value: 0n, account, chain: sepolia });
  await waitFor(regHash);
  console.log('  registered:', `https://sepolia.etherscan.io/tx/${regHash}`);

  const parentNode = namehash(parentName);
  const parentOwner = await pub.readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: 'owner', args: [parentNode] });
  console.log('  registry.owner(parent):', parentOwner, getAddress(parentOwner as Address) === account.address ? '✓ (you own it, unwrapped)' : '');

  // --- 2. create the subname under our parent, pointed at PublicResolver ------
  console.log(`· registry.setSubnodeRecord → ${fullName} …`);
  await waitFor(await wallet.writeContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: 'setSubnodeRecord', args: [parentNode, labelhash(subLabel), account.address, PUBLIC_RESOLVER, 0n], account, chain: sepolia }));

  const node = namehash(fullName);
  const textValue = buildUsageRecord(fullName);

  // --- 3. write the address + boa.usage text records --------------------------
  console.log(`· setAddr → ${agentAddress} …`);
  await waitFor(await wallet.writeContract({ address: PUBLIC_RESOLVER, abi: resolverAbi, functionName: 'setAddr', args: [node, agentAddress], account, chain: sepolia }));
  console.log('· setText boa.usage …');
  await waitFor(await wallet.writeContract({ address: PUBLIC_RESOLVER, abi: resolverAbi, functionName: 'setText', args: [node, 'boa.usage', textValue], account, chain: sepolia }));

  // --- 4. read back: high-level viem ENS first, then direct resolver fallback --
  let resolvedAddress: string | null = null;
  let textReadBack: string | null = null;
  try {
    resolvedAddress = await pub.getEnsAddress({ name: fullName });
    textReadBack = await pub.getEnsText({ name: fullName, key: 'boa.usage' });
  } catch (e: any) {
    console.log('  (universal resolver read failed, using direct resolver:', e?.shortMessage || e?.message, ')');
  }
  if (resolvedAddress == null || textReadBack == null) {
    const res = getAddress((await pub.readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: 'resolver', args: [node] })) as Address);
    resolvedAddress = (await pub.readContract({ address: res, abi: resolverAbi, functionName: 'addr', args: [node] })) as string;
    textReadBack = (await pub.readContract({ address: res, abi: resolverAbi, functionName: 'text', args: [node, 'boa.usage'] })) as string;
  }

  const addrOk = !!resolvedAddress && getAddress(resolvedAddress) === agentAddress;
  const textOk = textReadBack === textValue;

  console.log('\n--- LIVE SEPOLIA ENS write/read-back ---');
  console.log('subname            :', fullName);
  console.log('resolved → address :', resolvedAddress, addrOk ? '✓' : '✗ MISMATCH');
  console.log('text["boa.usage"]  :', textReadBack);
  console.log('read-back matches  :', textOk ? '✓' : '✗ MISMATCH');
  console.log('view on ENS app    :', `https://sepolia.app.ens.domains/${fullName}`);

  const result = {
    network: 'sepolia',
    controller: CONTROLLER,
    parentName,
    fullName,
    owner: account.address,
    agentAddress,
    resolvedAddress,
    boaUsage: textReadBack,
    pass: addrOk && textOk,
    registerTx: `https://sepolia.etherscan.io/tx/${regHash}`,
    ensApp: `https://sepolia.app.ens.domains/${fullName}`,
  };
  writeFileSync('sepolia-result.json', JSON.stringify(result, null, 2));
  console.log('\nSEPOLIA RESULT:', result.pass ? 'PASS ✅' : 'FAIL ❌', '(saved to spikes/ens/sepolia-result.json)');
  process.exit(result.pass ? 0 : 1);
}

main().catch((e) => {
  console.error('Sepolia full run error:', e?.shortMessage || e?.message || e);
  process.exit(1);
});
