// [2/3] CCTP V2: bridge USDC from Base Sepolia INTO Arc (burn -> attest -> mint).
// Default = SIMULATE (prints the exact real calls with real contracts/domains).
// Set CCTP_LIVE=1 (and have a funded Base Sepolia sender in PRIVATE_KEY_A + test ETH
// for gas there) to actually execute on-chain.
import "dotenv/config";
import { ethers } from "ethers";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  ARC, BASE_SEPOLIA, CCTP_V2,
  ERC20_ABI, TOKEN_MESSENGER_V2_ABI, MESSAGE_TRANSMITTER_V2_ABI,
} from "./config";

const toBytes32 = (addr: string) => ethers.zeroPadValue(addr, 32);

export interface BridgeParams {
  amountUsdc: string; // e.g. "5"
  recipient: string;  // recipient address on Arc
  live?: boolean;
}

export async function bridgeUsdcToArc(p: BridgeParams) {
  const src = BASE_SEPOLIA;
  const dst = ARC;
  const amount = ethers.parseUnits(p.amountUsdc, src.decimals);
  const mintRecipient = toBytes32(p.recipient);
  const destinationCaller = ethers.ZeroHash; // 0 => anyone may submit the mint
  const maxFee = 0n;                          // 0 + threshold 2000 => standard transfer
  const minFinalityThreshold = 2000;          // 2000 = standard finality, 1000 = fast

  console.log(`CCTP V2 bridge: ${p.amountUsdc} USDC  Base Sepolia(domain ${src.cctpDomain}) -> Arc(domain ${dst.cctpDomain})`);
  console.log(`  recipient (Arc):      ${p.recipient}`);
  console.log(`  TokenMessengerV2:     ${CCTP_V2.tokenMessenger}`);
  console.log(`  MessageTransmitterV2: ${CCTP_V2.messageTransmitter}`);
  console.log(`  Iris (attestation):   ${CCTP_V2.irisApi}`);

  if (!p.live) {
    console.log(`\n  [SIMULATE] set CCTP_LIVE=1 + a funded Base Sepolia sender to execute for real:`);
    console.log(`   1. approve : USDC(${src.usdc}).approve(${CCTP_V2.tokenMessenger}, ${amount})   [on Base Sepolia]`);
    console.log(`   2. burn    : TokenMessengerV2.depositForBurn(`);
    console.log(`                  amount=${amount}, destinationDomain=${dst.cctpDomain},`);
    console.log(`                  mintRecipient=${mintRecipient},`);
    console.log(`                  burnToken=${src.usdc},`);
    console.log(`                  destinationCaller=${destinationCaller}, maxFee=${maxFee}, minFinalityThreshold=${minFinalityThreshold})`);
    console.log(`   3. attest  : GET ${CCTP_V2.irisApi}/v2/messages/${src.cctpDomain}?transactionHash=<burnTx>`);
    console.log(`                  poll until status="complete" -> { message, attestation }`);
    console.log(`   4. mint    : MessageTransmitterV2.receiveMessage(message, attestation)   [on Arc]`);
    console.log(`                  => mints ${p.amountUsdc} native USDC to ${p.recipient} on Arc`);
    return { simulated: true as const };
  }

  // ---- LIVE ----
  const pk = process.env.PRIVATE_KEY_A!;
  const srcSigner = new ethers.Wallet(pk, new ethers.JsonRpcProvider(src.rpcUrl));
  const dstSigner = new ethers.Wallet(pk, new ethers.JsonRpcProvider(dst.rpcUrl));
  const usdc = new ethers.Contract(src.usdc, ERC20_ABI, srcSigner);
  const tm = new ethers.Contract(CCTP_V2.tokenMessenger, TOKEN_MESSENGER_V2_ABI, srcSigner);
  const mt = new ethers.Contract(CCTP_V2.messageTransmitter, MESSAGE_TRANSMITTER_V2_ABI, dstSigner);

  console.log("\n  [LIVE] 1. approve...");
  await (await usdc.approve(CCTP_V2.tokenMessenger, amount)).wait();
  console.log("  [LIVE] 2. depositForBurn...");
  const burnTx = await tm.depositForBurn(amount, dst.cctpDomain, mintRecipient, src.usdc, destinationCaller, maxFee, minFinalityThreshold);
  console.log(`         burn tx: ${burnTx.hash}`);
  await burnTx.wait();
  console.log("  [LIVE] 3. poll Iris for attestation...");
  const { message, attestation } = await pollAttestation(src.cctpDomain, burnTx.hash);
  console.log("  [LIVE] 4. receiveMessage on Arc...");
  const mintTx = await mt.receiveMessage(message, attestation);
  console.log(`         mint tx: ${mintTx.hash}`);
  await mintTx.wait();
  return { simulated: false as const, burnTx: burnTx.hash, mintTx: mintTx.hash };
}

async function pollAttestation(srcDomain: number, txHash: string, timeoutMs = 120_000) {
  const url = `${CCTP_V2.irisApi}/v2/messages/${srcDomain}?transactionHash=${txHash}`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await fetch(url);
    if (r.ok) {
      const j: any = await r.json();
      const m = j?.messages?.[0];
      if (m?.status === "complete" && m.attestation && m.attestation !== "PENDING") {
        return { message: m.message as string, attestation: m.attestation as string };
      }
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
  throw new Error("CCTP attestation timed out");
}

// Standalone CLI: `npm run cctp`
const isMain = !!process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const recipient = process.env.WALLET_A_ADDRESS || ethers.Wallet.createRandom().address;
  bridgeUsdcToArc({ amountUsdc: "5", recipient, live: process.env.CCTP_LIVE === "1" })
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
