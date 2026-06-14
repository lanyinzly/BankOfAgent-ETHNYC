// Network config for the BoA settlement-rail spike.
// All values verified live on 2026-06-13 (see ../README.md).

export type NetworkKey = "arc" | "base";

export interface NetCfg {
  label: string;
  rpcUrl: string;
  chainId: number;
  /** USDC ERC-20 interface address (6 decimals on both chains). */
  usdc: string;
  /** Symbol of the chain's native/gas asset. On Arc gas is paid in USDC. */
  gasSymbol: string;
  explorer: string;
  faucet: string;
  /** Separate faucet for the gas asset, when gas != USDC (e.g. ETH on Base Sepolia). */
  gasFaucet?: string;
}

export const NETWORKS: Record<NetworkKey, NetCfg> = {
  // PRIMARY rail for nanopayments.
  arc: {
    label: "Arc Testnet",
    rpcUrl: process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network",
    chainId: 5042002,
    usdc: "0x3600000000000000000000000000000000000000",
    gasSymbol: "USDC", // Arc uses USDC as its native gas token — no ETH needed.
    explorer: "https://testnet.arcscan.app",
    faucet: "https://faucet.circle.com  (select 'Arc Testnet')",
  },
  // FALLBACK rail: standard USDC ERC-20 transfer.
  base: {
    label: "Base Sepolia",
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
    chainId: 84532,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    gasSymbol: "ETH", // Base Sepolia pays gas in ETH — wallet A also needs test ETH.
    explorer: "https://base-sepolia.blockscout.com",
    faucet: "https://faucet.circle.com  (select 'Base Sepolia')",
    gasFaucet: "https://www.alchemy.com/faucets/base-sepolia  (test ETH for gas)",
  },
};

// Minimal ERC-20 ABI — all we need to read balances and move USDC.
export const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];
