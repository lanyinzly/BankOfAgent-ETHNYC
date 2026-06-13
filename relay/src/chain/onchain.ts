// Onchain FOAMM adapter — OPTIONAL (CHAIN_MODE=onchain).
//
// Talks to the deployed ERC-7527 Agency/App clones on Base Sepolia via viem.
// Reads the live FOAMM oracle for prices and sends real wrap/unwrap/transfer txs.
// Requires: a deployed market (contracts/deployments.json), an RPC URL, and a
// funded private key for each acting agent (provided by the identity rail).
//
// The default demo path is the in-memory adapter; this exists so the exact same
// relay can be pointed at the real chain once a funded key is available.

import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  encodeAbiParameters,
  formatEther,
  type PublicClient,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ChainAdapter, MarketInfo, PriceInfo, WrapResult, UnwrapResult } from "../types.ts";
import type { MarketConfig } from "../config.ts";

const AGENCY_ABI = [
  {
    type: "function",
    name: "wrap",
    stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "unwrap",
    stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getWrapOracle",
    stateMutability: "view",
    inputs: [{ name: "data", type: "bytes" }],
    outputs: [
      { name: "premium", type: "uint256" },
      { name: "fee", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getUnwrapOracle",
    stateMutability: "view",
    inputs: [{ name: "data", type: "bytes" }],
    outputs: [
      { name: "premium", type: "uint256" },
      { name: "fee", type: "uint256" },
    ],
  },
] as const;

const APP_ABI = [
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export type SignerResolver = (address: string) => Hex | null;

function encodeUint(n: bigint): Hex {
  return encodeAbiParameters([{ type: "uint256" }], [n]);
}

export class OnchainFoamm implements ChainAdapter {
  readonly mode = "onchain" as const;
  private pub: PublicClient;
  private chain: ReturnType<typeof defineChain>;
  private minted = 0;
  private seeded = false;
  private cfg: MarketConfig;
  private rpcUrl: string;
  private getSigner: SignerResolver;

  constructor(cfg: MarketConfig, rpcUrl: string, getSigner: SignerResolver) {
    this.cfg = cfg;
    this.rpcUrl = rpcUrl;
    this.getSigner = getSigner;
    const chainId = cfg.chainId ?? 84532; // default Base Sepolia
    this.chain = defineChain({
      id: chainId,
      name: chainId === 84532 ? "Base Sepolia" : `chain-${chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    // cast: viem infers a chain-specialized client; pin it to the canonical
    // PublicClient type so downstream calls don't trip TS2719 (dup-type noise).
    this.pub = createPublicClient({ chain: this.chain, transport: http(rpcUrl) }) as unknown as PublicClient;
    if (cfg.agency === "0x0000000000000000000000000000000000000000") {
      throw new Error(
        "CHAIN_MODE=onchain but no deployed market found. Deploy contracts and ensure contracts/deployments.json is populated.",
      );
    }
  }

  private wallet(address: string) {
    const pk = this.getSigner(address);
    if (!pk) throw new Error(`no signing key for ${address} (onchain mode needs a funded agent key)`);
    const account = privateKeyToAccount(pk);
    return createWalletClient({ account, chain: this.chain, transport: http(this.rpcUrl) });
  }

  market(): MarketInfo {
    return {
      id: this.cfg.id,
      agency: this.cfg.agency,
      app: this.cfg.app,
      currency: this.cfg.currency,
      basePremium: this.cfg.basePremium,
      mintFeePercent: this.cfg.mintFeePercent,
      burnFeePercent: this.cfg.burnFeePercent,
      maxSupply: this.cfg.maxSupply,
    };
  }

  private async wrapOracle(sold: bigint): Promise<{ premium: bigint; fee: bigint }> {
    const [premium, fee] = (await this.pub.readContract({
      address: this.cfg.agency as Hex,
      abi: AGENCY_ABI,
      functionName: "getWrapOracle",
      args: [encodeUint(sold)],
    })) as [bigint, bigint];
    return { premium, fee };
  }

  private async unwrapOracle(sold: bigint): Promise<{ premium: bigint; fee: bigint }> {
    const [premium, fee] = (await this.pub.readContract({
      address: this.cfg.agency as Hex,
      abi: AGENCY_ABI,
      functionName: "getUnwrapOracle",
      args: [encodeUint(sold)],
    })) as [bigint, bigint];
    return { premium, fee };
  }

  async totalSupply(): Promise<number> {
    const ts = (await this.pub.readContract({
      address: this.cfg.app as Hex,
      abi: APP_ABI,
      functionName: "totalSupply",
    })) as bigint;
    return Number(ts);
  }

  async price(): Promise<PriceInfo> {
    const sold = await this.totalSupply();
    const cur = await this.wrapOracle(BigInt(sold));
    const next = await this.wrapOracle(BigInt(sold + 1));
    return {
      market: this.cfg.id,
      sold,
      basePremium: formatEther(this.cfg.basePremium),
      currentPremium: formatEther(cur.premium),
      nextPremium: formatEther(next.premium),
      basePremiumWei: this.cfg.basePremium.toString(),
      currentPremiumWei: cur.premium.toString(),
      nextPremiumWei: next.premium.toString(),
      currency: this.cfg.currency,
    };
  }

  // pick a fresh, never-before-used tokenId
  private async nextTokenId(): Promise<number> {
    if (!this.seeded) {
      this.minted = await this.totalSupply();
      this.seeded = true;
    }
    let candidate = this.minted + 1;
    // bump past any id that already exists on-chain
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const owner = await this.ownerOf(candidate);
      if (!owner) break;
      candidate++;
    }
    this.minted = candidate;
    return candidate;
  }

  async wrap(toAddress: `0x${string}`): Promise<WrapResult> {
    const soldBefore = await this.totalSupply();
    const { premium, fee } = await this.wrapOracle(BigInt(soldBefore));
    const tokenId = await this.nextTokenId();

    const wallet = this.wallet(toAddress);
    const hash = await wallet.writeContract({
      address: this.cfg.agency as Hex,
      abi: AGENCY_ABI,
      functionName: "wrap",
      args: [toAddress, encodeUint(BigInt(tokenId))],
      value: premium + fee,
      account: wallet.account!,
      chain: this.chain,
    });
    await this.pub.waitForTransactionReceipt({ hash });

    const after = await this.wrapOracle(BigInt(soldBefore + 1));
    return {
      tokenId,
      pricePaid: formatEther(premium + fee),
      priceBefore: formatEther(premium),
      priceAfter: formatEther(after.premium),
      txHash: hash,
    };
  }

  async unwrap(ownerAddress: `0x${string}`, tokenId: number): Promise<UnwrapResult> {
    const soldBefore = await this.totalSupply();
    const postSold = Math.max(0, soldBefore - 1);
    const { premium, fee } = await this.unwrapOracle(BigInt(postSold));

    const wallet = this.wallet(ownerAddress);
    const hash = await wallet.writeContract({
      address: this.cfg.agency as Hex,
      abi: AGENCY_ABI,
      functionName: "unwrap",
      args: [ownerAddress, BigInt(tokenId), "0x"],
      account: wallet.account!,
      chain: this.chain,
    });
    await this.pub.waitForTransactionReceipt({ hash });

    return { tokenId, refund: formatEther(premium - fee), txHash: hash };
  }

  async transfer(from: `0x${string}`, to: `0x${string}`, tokenId: number): Promise<{ txHash?: string }> {
    const wallet = this.wallet(from);
    const hash = await wallet.writeContract({
      address: this.cfg.app as Hex,
      abi: APP_ABI,
      functionName: "transferFrom",
      args: [from, to, BigInt(tokenId)],
      account: wallet.account!,
      chain: this.chain,
    });
    await this.pub.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  }

  async ownerOf(tokenId: number): Promise<`0x${string}` | null> {
    try {
      const owner = (await this.pub.readContract({
        address: this.cfg.app as Hex,
        abi: APP_ABI,
        functionName: "ownerOf",
        args: [BigInt(tokenId)],
      })) as `0x${string}`;
      return owner;
    } catch {
      return null; // ERC721 reverts for non-existent token
    }
  }
}
