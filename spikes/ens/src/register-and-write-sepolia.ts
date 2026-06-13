/**
 * LIVE SEPOLIA — full ENS rail on a real testnet, funds-in-the-loop.
 *
 *   register  boa-spike-<rand>.eth   (ETHRegistrarController, commit→wait→register; wrapped in NameWrapper)
 *   create    agent-a.boa-spike-<rand>.eth   (NameWrapper.setSubnodeRecord -> PublicResolver)
 *   write     setAddr + setText("boa.usage", <usage digest JSON>)
 *   read-back resolve subname -> address, read boa.usage, assert identical (via viem ENS / universal resolver)
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
const nameWrapperArtifact = require('@ensdomains/ens-contracts/deployments/sepolia/NameWrapper.json');

// Canonical Sepolia ENS deployments
const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as Address;
const PUBLIC_RESOLVER = '0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5' as Address;
const CONTROLLER = getAddress(controllerArtifact.address);
const NAME_WRAPPER = getAddress(nameWrapperArtifact.address);
const ZERO_BYTES32 = `0x${'00'.repeat(32)}` as Hex;

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const rpc = process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
  const account = privateKeyToAccount(loadKey());
  const agentAddress = getAddress(process.env.AGENT_ADDRESS || '0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
  const subLabel = process.env.AGENT_LABEL || 'agent-a';
  const durationSec = 2_592_000n; // 30 days (> 28d minimum)

  const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });

  console.log('account            :', account.address);
  console.log('controller         :', CONTROLLER);
  console.log('name wrapper       :', NAME_WRAPPER);

  const balance = await pub.getBalance({ address: account.address });
  console.log('balance            :', `${Number(balance) / 1e18} ETH`);

  // pick an available label
  let label = process.env.PARENT_LABEL || `boa-spike-${Math.random().toString(16).slice(2, 10)}`;
  for (let i = 0; i < 5; i++) {
    const available = await pub.readContract({ address: CONTROLLER, abi: controllerArtifact.abi, functionName: 'available', args: [label] });
    if (available) break;
    label = `boa-spike-${Math.random().toString(16).slice(2, 10)}`;
  }
  const parentName = `${label}.eth`;
  const fullName = `${subLabel}.${parentName}`;
  console.log('parent (to mint)   :', parentName);
  console.log('subname (target)   :', fullName);

  const rent = (await pub.readContract({ address: CONTROLLER, abi: controllerArtifact.abi, functionName: 'rentPrice', args: [label, durationSec] })) as { base: bigint; premium: bigint };
  const price = rent.base + rent.premium;
  const value = price + price / 20n; // +5% buffer; excess is refunded
  console.log('rent price         :', `${Number(price) / 1e18} ETH (sending ${Number(value) / 1e18})`);

  if (balance === 0n) {
    console.log('\n⏳ NOT FUNDED YET. Send Sepolia ETH to', account.address, 'then run `npm run sepolia:full`.');
    process.exit(2);
  }
  if (balance < value) {
    console.log('\n⚠️  balance below rent price; top up the faucet a bit more.');
    process.exit(2);
  }

  // --- commit → wait → register ----------------------------------------------
  const secret = keccak256(toHex(`${account.address}-${Date.now()}-${Math.random()}`));
  const registration = {
    label,
    owner: account.address,
    duration: durationSec,
    secret,
    resolver: PUBLIC_RESOLVER,
    data: [] as Hex[],
    reverseRecord: 0, // uint8: no reverse record
    referrer: ZERO_BYTES32,
  };

  const commitment = (await pub.readContract({ address: CONTROLLER, abi: controllerArtifact.abi, functionName: 'makeCommitment', args: [registration] })) as Hex;
  console.log('\n· commit …');
  await pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: CONTROLLER, abi: controllerArtifact.abi, functionName: 'commit', args: [commitment], account, chain: sepolia }) });

  const minAge = (await pub.readContract({ address: CONTROLLER, abi: controllerArtifact.abi, functionName: 'minCommitmentAge' })) as bigint;
  const waitMs = Number(minAge) * 1000 + 5000;
  console.log(`· waiting minCommitmentAge (${minAge}s + 5s) …`);
  await sleep(waitMs);

  console.log('· register (payable) …');
  const regHash = await wallet.writeContract({ address: CONTROLLER, abi: controllerArtifact.abi, functionName: 'register', args: [registration], value, account, chain: sepolia });
  await pub.waitForTransactionReceipt({ hash: regHash });
  console.log('  registered:', `https://sepolia.etherscan.io/tx/${regHash}`);

  // --- create the subname via NameWrapper (parent is wrapped) ----------------
  console.log(`· NameWrapper.setSubnodeRecord → ${fullName} …`);
  const subHash = await wallet.writeContract({
    address: NAME_WRAPPER,
    abi: nameWrapperArtifact.abi,
    functionName: 'setSubnodeRecord',
    args: [namehash(parentName), subLabel, account.address, PUBLIC_RESOLVER, 0n, 0, 0n], // ttl, fuses, expiry
    account,
    chain: sepolia,
  });
  await pub.waitForTransactionReceipt({ hash: subHash });

  const node = namehash(fullName);
  const textValue = buildUsageRecord(fullName);

  console.log(`· setAddr → ${agentAddress} …`);
  await pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: PUBLIC_RESOLVER, abi: resolverAbi, functionName: 'setAddr', args: [node, agentAddress], account, chain: sepolia }) });
  console.log('· setText boa.usage …');
  await pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: PUBLIC_RESOLVER, abi: resolverAbi, functionName: 'setText', args: [node, 'boa.usage', textValue], account, chain: sepolia }) });

  // --- read back via high-level viem ENS (universal resolver) ----------------
  const resolvedAddress = await pub.getEnsAddress({ name: fullName });
  const textReadBack = await pub.getEnsText({ name: fullName, key: 'boa.usage' });

  const addrOk = !!resolvedAddress && getAddress(resolvedAddress) === agentAddress;
  const textOk = textReadBack === textValue;

  console.log('\n--- LIVE SEPOLIA ENS write/read-back ---');
  console.log('subname            :', fullName);
  console.log('resolved → address :', resolvedAddress, addrOk ? '✓' : '✗ MISMATCH');
  console.log('text["boa.usage"]  :', textReadBack);
  console.log('read-back matches  :', textOk ? '✓' : '✗ MISMATCH');
  console.log('app.ens.domains    :', `https://sepolia.app.ens.domains/${fullName}`);

  const result = {
    network: 'sepolia',
    parentName,
    fullName,
    agentAddress,
    resolvedAddress,
    boaUsage: textReadBack,
    pass: addrOk && textOk,
    registerTx: `https://sepolia.etherscan.io/tx/${regHash}`,
    ensApp: `https://sepolia.app.ens.domains/${fullName}`,
    owner: account.address,
  };
  writeFileSync('sepolia-result.json', JSON.stringify(result, null, 2));
  console.log('\nSEPOLIA RESULT:', result.pass ? 'PASS ✅' : 'FAIL ❌', '(saved to spikes/ens/sepolia-result.json)');
  process.exit(result.pass ? 0 : 1);
}

main().catch((e) => {
  console.error('Sepolia full run error:', e?.shortMessage || e?.message || e);
  process.exit(1);
});
