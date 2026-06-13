/**
 * CORE DoD PROOF — write + read-back of an ENS text record on a subname.
 *
 * Strategy: deploy the genuine ENS `ENSRegistry` + `OwnedResolver` contracts
 * onto a throwaway in-process chain (ganache), then:
 *   1. build the name tree  eth -> <parent>.eth -> agent-a.<parent>.eth
 *   2. resolve the subname -> address  (via registry + resolver, the real path)
 *   3. setText(node, "boa.usage", <usage digest JSON>)
 *   4. read the text record back and assert it is byte-for-byte identical
 *
 * This needs no testnet, no faucet, no private key — but it runs the exact ENS
 * contract logic BoA would hit on Sepolia/L2, so it is a faithful go/no-go signal.
 */
import Ganache from 'ganache';
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  getAddress,
  keccak256,
  namehash,
  labelhash,
  toHex,
  zeroAddress,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ENSRegistry, OwnedResolver } from './ens-fixtures.js';

const ROOT_NODE = `0x${'00'.repeat(32)}` as const; // namehash('') — the ENS root

// Well-known throwaway test keys (the standard anvil/hardhat dev keys). Only ever
// used against the disposable in-process chain — never funded on a real network.
const DEPLOYER_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const AGENT_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;

const localChain = defineChain({
  id: 1337,
  name: 'ganache-local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [] } },
});

export type LocalResult = {
  pass: boolean;
  fullName: string;
  expectedAddress: Address;
  resolvedAddress: Address;
  textKey: string;
  textWritten: string;
  textReadBack: string;
  registry: Address;
  resolver: Address;
};

export async function runLocal(log: (s: string) => void = console.log): Promise<LocalResult> {
  const parentLabel = process.env.PARENT_LABEL || 'boa-demo';
  const subLabel = process.env.AGENT_LABEL || 'agent-a';
  const parentName = `${parentLabel}.eth`;
  const fullName = `${subLabel}.${parentName}`;
  const textKey = 'boa.usage';

  // --- sample "usage digest" we want to anchor on-chain for this agent -------
  const usage = {
    agent: fullName,
    period: '2026-06-13',
    model: 'claude-opus',
    requests: 97,
    tokensIn: 120_443,
    tokensOut: 88_210,
  };
  const usageJson = JSON.stringify(usage);
  const usageDigest = keccak256(toHex(usageJson)); // hash anyone can recompute & verify
  const textValue = JSON.stringify({ ...usage, digest: usageDigest });

  // --- spin up an isolated in-process chain ----------------------------------
  const deployer = privateKeyToAccount(DEPLOYER_PK); // owns the name tree
  const agent = privateKeyToAccount(AGENT_PK); // the address the subname points at
  const owner = deployer.address;
  const agentAddress = agent.address;

  const provider: any = Ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 1337, networkId: 1337 },
    miner: { instamine: 'eager' },
    // pre-fund the deployer so viem can sign locally and broadcast eth_sendRawTransaction
    wallet: { accounts: [{ secretKey: DEPLOYER_PK, balance: '0x3635C9ADC5DEA00000' }] },
  });
  try {
    const transport = custom(provider);
    const wallet = createWalletClient({ account: deployer, chain: localChain, transport });
    const pub = createPublicClient({ chain: localChain, transport, pollingInterval: 100 });

    const send = async (
      address: Address,
      abi: any[],
      functionName: string,
      args: any[],
    ): Promise<void> => {
      const hash = await wallet.writeContract({ address, abi, functionName, args, account: deployer, chain: localChain });
      await pub.waitForTransactionReceipt({ hash });
    };

    // 1. deploy the real ENS registry (constructor sets root owner = deployer) --
    log('· deploying ENSRegistry …');
    const regHash = await wallet.deployContract({ abi: ENSRegistry.abi, bytecode: ENSRegistry.bytecode, account: deployer, chain: localChain, args: [] });
    const registry = getAddress((await pub.waitForTransactionReceipt({ hash: regHash })).contractAddress!);

    // 2. deploy the real OwnedResolver (no-arg ctor; deployer becomes its owner) -
    log('· deploying OwnedResolver …');
    const resHash = await wallet.deployContract({
      abi: OwnedResolver.abi,
      bytecode: OwnedResolver.bytecode,
      account: deployer,
      chain: localChain,
      args: [],
    });
    const resolver = getAddress((await pub.waitForTransactionReceipt({ hash: resHash })).contractAddress!);

    // 3. build the name tree: root -> eth -> <parent>.eth -> agent-a.<parent>.eth
    log(`· building name tree  eth → ${parentName} → ${fullName} …`);
    await send(registry, ENSRegistry.abi, 'setSubnodeOwner', [ROOT_NODE, labelhash('eth'), owner]);
    await send(registry, ENSRegistry.abi, 'setSubnodeOwner', [namehash('eth'), labelhash(parentLabel), owner]);
    // create the subname AND point it at the resolver in one call
    await send(registry, ENSRegistry.abi, 'setSubnodeRecord', [
      namehash(parentName),
      labelhash(subLabel),
      owner,
      resolver,
      0n,
    ]);

    const node = namehash(fullName);

    // 4. write the address record + the boa.usage text record ------------------
    log(`· setAddr(${fullName}) → ${agentAddress}`);
    await send(resolver, OwnedResolver.abi, 'setAddr', [node, agentAddress]);
    log(`· setText(${fullName}, "${textKey}") → <usage digest, ${textValue.length} bytes>`);
    await send(resolver, OwnedResolver.abi, 'setText', [node, textKey, textValue]);

    // 5. resolve the subname the way a consumer would: registry → resolver → addr
    const resolverFromRegistry = getAddress(
      (await pub.readContract({ address: registry, abi: ENSRegistry.abi, functionName: 'resolver', args: [node] })) as Address,
    );
    const resolvedAddress = getAddress(
      (await pub.readContract({ address: resolverFromRegistry, abi: OwnedResolver.abi, functionName: 'addr', args: [node] })) as Address,
    );

    // 6. read the text record back ---------------------------------------------
    const textReadBack = (await pub.readContract({
      address: resolverFromRegistry,
      abi: OwnedResolver.abi,
      functionName: 'text',
      args: [node, textKey],
    })) as string;

    const addrOk = resolvedAddress === agentAddress;
    const textOk = textReadBack === textValue;

    return {
      pass: addrOk && textOk,
      fullName,
      expectedAddress: agentAddress,
      resolvedAddress,
      textKey,
      textWritten: textValue,
      textReadBack,
      registry,
      resolver,
    };
  } finally {
    await provider.disconnect();
  }
}

// allow running this file directly: `tsx src/write-read-local.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  runLocal().then((r) => {
    console.log('\n--- LOCAL ENS write/read-back ---');
    console.log('subname            :', r.fullName);
    console.log('resolved → address :', r.resolvedAddress, r.resolvedAddress === r.expectedAddress ? '✓' : '✗ MISMATCH');
    console.log(`text["${r.textKey}"]  :`, r.textReadBack);
    console.log('read-back matches  :', r.textReadBack === r.textWritten ? '✓' : '✗ MISMATCH');
    console.log('\nRESULT:', r.pass ? 'PASS ✅' : 'FAIL ❌');
    process.exit(r.pass ? 0 : 1);
  }).catch((e) => {
    console.error('LOCAL ENS spike threw:', e);
    process.exit(1);
  });
}
