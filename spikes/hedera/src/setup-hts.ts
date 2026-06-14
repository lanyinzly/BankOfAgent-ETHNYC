import "dotenv/config";
import {
  Client,
  PrivateKey,
  AccountCreateTransaction,
  Hbar,
  TokenCreateTransaction,
  TokenType,
  TransferTransaction,
} from "@hashgraph/sdk";
import { appendFileSync, readFileSync } from "node:fs";

/**
 * One-off setup for HTS-USDC two-party settlement on Hedera testnet.
 *
 * Creates:
 *   - an HTS fungible "USDC" token (6 decimals, treasury = operator)  ← the unit of account, native on Hedera
 *   - an AGENT account (payer)     funded with HBAR (fees) + USDC (its deposited balance)
 *   - a PROVIDER account (payee)   the service provider that receives USDC per call
 *
 * Appends the resulting ids/keys to .env (git-ignored). Run once:  npm run setup:hts
 */

function parseKey(raw: string, type: string): PrivateKey {
  try {
    return type.toUpperCase() === "ECDSA" ? PrivateKey.fromStringECDSA(raw) : PrivateKey.fromStringED25519(raw);
  } catch {
    return PrivateKey.fromStringDer(raw);
  }
}

const operatorId = process.env.HEDERA_OPERATOR_ID!;
const operatorKey = parseKey(process.env.HEDERA_OPERATOR_KEY!, process.env.HEDERA_OPERATOR_KEY_TYPE ?? "ECDSA");
const client = Client.forTestnet().setOperator(operatorId, operatorKey);

const DECIMALS = 6;
const usdc = (n: number) => n * 10 ** DECIMALS; // human USDC → base units

async function main() {
  if (/^HEDERA_USDC_TOKEN_ID=/m.test(readFileSync(".env", "utf8"))) {
    console.log("HEDERA_USDC_TOKEN_ID already in .env — refusing to create a second token. Remove it to re-run.");
    process.exit(0);
  }

  // 1) USDC HTS token, treasury = operator
  const tokenResp = await new TokenCreateTransaction()
    .setTokenName("USD Coin (BoA testnet)")
    .setTokenSymbol("USDC")
    .setTokenType(TokenType.FungibleCommon)
    .setDecimals(DECIMALS)
    .setInitialSupply(usdc(1_000_000))
    .setTreasuryAccountId(operatorId)
    .execute(client);
  const tokenId = (await tokenResp.getReceipt(client)).tokenId!.toString();
  console.log("USDC token:", tokenId);

  // 2) agent (payer) + provider (payee) accounts; auto-associate the token
  async function mkAccount(initialHbar: number) {
    const key = PrivateKey.generateED25519();
    const resp = await new AccountCreateTransaction()
      .setKey(key.publicKey)
      .setInitialBalance(new Hbar(initialHbar))
      .setMaxAutomaticTokenAssociations(2)
      .execute(client);
    const id = (await resp.getReceipt(client)).accountId!.toString();
    return { id, key: key.toStringDer() };
  }
  const agent = await mkAccount(10); // HBAR for its own tx fees (autonomous payer)
  const provider = await mkAccount(1);
  console.log("agent (payer):", agent.id, " provider (payee):", provider.id);

  // 3) fund the agent's USDC balance (its "deposit")
  const fund = await new TransferTransaction()
    .addTokenTransfer(tokenId, operatorId, -usdc(1000))
    .addTokenTransfer(tokenId, agent.id, usdc(1000))
    .execute(client);
  await fund.getReceipt(client);
  console.log("funded agent with 1000 USDC");

  appendFileSync(
    ".env",
    `HEDERA_USDC_TOKEN_ID=${tokenId}\n` +
      `HEDERA_AGENT_ID=${agent.id}\n` +
      `HEDERA_AGENT_KEY=${agent.key}\n` +
      `HEDERA_PROVIDER_ID=${provider.id}\n` +
      `HEDERA_PROVIDER_KEY=${provider.key}\n` +
      `HEDERA_SETTLE_ASSET=USDC\n`,
  );
  console.log("\nappended HTS settlement vars to .env:");
  console.log(`  HEDERA_USDC_TOKEN_ID=${tokenId}`);
  console.log(`  HEDERA_AGENT_ID=${agent.id}`);
  console.log(`  HEDERA_PROVIDER_ID=${provider.id}`);
  console.log(`\nhashscan token: https://hashscan.io/testnet/token/${tokenId}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("setup failed:", e);
    process.exit(1);
  });
