// Config for the BoA agentic demo: Circle Programmable Wallets + CCTP V2 + x402 on Arc.
// All addresses/domains verified live on 2026-06-13 (see ../../README.md "Agentic demo").

export const ARC = {
  key: "arc-testnet",
  rpcUrl: process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network",
  chainId: 5042002,
  usdc: "0x3600000000000000000000000000000000000000",
  decimals: 6,
  cctpDomain: 26,
  explorer: "https://testnet.arcscan.app",
} as const;

export const BASE_SEPOLIA = {
  key: "base-sepolia",
  rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
  chainId: 84532,
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  decimals: 6,
  cctpDomain: 6,
  explorer: "https://base-sepolia.blockscout.com",
} as const;

// CCTP V2 testnet contracts (same address across supported EVM testnets) + the
// sandbox attestation (Iris) service. Domain IDs per Circle docs.
export const CCTP_V2 = {
  tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
  tokenMinter: "0xb43db544E2c27092c107639Ad201b3dEfAbcF192",
  irisApi: "https://iris-api-sandbox.circle.com",
  domains: { ethereumSepolia: 0, avalancheFuji: 1, baseSepolia: 6, arcTestnet: 26 },
} as const;

export const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

// CCTP V2 depositForBurn (7 args) and receiveMessage.
export const TOKEN_MESSENGER_V2_ABI = [
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) returns (uint64)",
];
export const MESSAGE_TRANSMITTER_V2_ABI = [
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
];
