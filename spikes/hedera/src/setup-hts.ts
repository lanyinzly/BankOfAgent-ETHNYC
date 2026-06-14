// One-time HTS-USDC setup for the BoA Hedera agentic-payments demo.
//
// From the funded operator, creates:
//   * a USDC HTS token (6 dp, treasury = operator),
//   * an AGENT account (autonomous payer; funded 10 HBAR + 1000 USDC),
//   * a PROVIDER account (payee; funded 1 HBAR, token associated),
// then appends the ids/keys to spikes/hedera/.env so `npm start` (server.ts) settles
// real USDC agent -> provider on every emit.
//
// Run:  cd spikes/hedera && npm run setup:hts
import "dotenv/config";
import { appendFileSync } from "node:fs";
import {
  Client,
  PrivateKey,
  Hbar,
  AccountCreateTransaction,
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  TokenAssociateTransaction,
  TransferTransaction,
  TokenId,
  AccountId,
} from "@hashgraph/sdk";

function parseKey(raw: string, type = "ED25519"): PrivateKey {
  try {
    return type.toUpperCase() === "ECDSA" ? PrivateKey.fromStringECDSA(raw) : PrivateKey.fromStringED25519(raw);
  } catch {
    return PrivateKey.fromStringDer(raw);
  }
}

const operatorId = process.env.HEDERA_OPERATOR_ID!;
const operatorKey = parseKey(process.env.HEDERA_OPERATOR_KEY!, process.env.HEDERA_OPERATOR_KEY_TYPE ?? "ED25519");
const client = Client.forTestnet().setOperator(operatorId, operatorKey);

const DECIMALS = 6;
const AGENT_USDC = 1000; // initial agent USDC balance

async function main() {
  if (!operatorId || !process.env.HEDERA_OPERATOR_KEY) throw new Error("set HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY");

  console.log("operator:", operatorId);

  // 1. accounts
  const agentKey = PrivateKey.generateED25519();
  const providerKey = PrivateKey.generateED25519();
  const agentId = (
    await (await new AccountCreateTransaction().setKey(agentKey.publicKey).setInitialBalance(new Hbar(10)).execute(client)).getReceipt(client)
  ).accountId!.toString();
  const providerId = (
    await (await new AccountCreateTransaction().setKey(providerKey.publicKey).setInitialBalance(new Hbar(1)).execute(client)).getReceipt(client)
  ).accountId!.toString();
  console.log("agent   :", agentId);
  console.log("provider:", providerId);

  // 2. USDC token (treasury = operator)
  const tokenId = (
    await (
      await new TokenCreateTransaction()
        .setTokenName("Bank of Agent USDC")
        .setTokenSymbol("USDC")
        .setTokenType(TokenType.FungibleCommon)
        .setDecimals(DECIMALS)
        .setInitialSupply(1_000_000 * 10 ** DECIMALS)
        .setTreasuryAccountId(AccountId.fromString(operatorId))
        .setAdminKey(operatorKey.publicKey)
        .setSupplyType(TokenSupplyType.Infinite)
        .setSupplyKey(operatorKey.publicKey)
        .execute(client)
    ).getReceipt(client)
  ).tokenId!.toString();
  console.log("USDC token:", tokenId);

  // 3. associate token to agent + provider
  for (const [id, key] of [
    [agentId, agentKey],
    [providerId, providerKey],
  ] as const) {
    const tx = await new TokenAssociateTransaction()
      .setAccountId(AccountId.fromString(id))
      .setTokenIds([TokenId.fromString(tokenId)])
      .freezeWith(client)
      .sign(key);
    await (await tx.execute(client)).getReceipt(client);
  }
  console.log("associated token to agent + provider");

  // 4. fund the agent with USDC (treasury operator -> agent)
  const units = AGENT_USDC * 10 ** DECIMALS;
  await (
    await new TransferTransaction()
      .addTokenTransfer(TokenId.fromString(tokenId), AccountId.fromString(operatorId), -units)
      .addTokenTransfer(TokenId.fromString(tokenId), AccountId.fromString(agentId), units)
      .execute(client)
  ).getReceipt(client);
  console.log(`funded agent with ${AGENT_USDC} USDC`);

  // 5. append to .env
  const lines = [
    "",
    "# ── added by setup:hts ──",
    `HEDERA_USDC_TOKEN_ID=${tokenId}`,
    `HEDERA_AGENT_ID=${agentId}`,
    `HEDERA_AGENT_KEY=${agentKey.toStringRaw()}`,
    `HEDERA_AGENT_KEY_TYPE=ED25519`,
    `HEDERA_PROVIDER_ID=${providerId}`,
    `HEDERA_PROVIDER_KEY=${providerKey.toStringRaw()}`,
    "",
  ].join("\n");
  appendFileSync(".env", lines);
  console.log("\nappended USDC settlement config to spikes/hedera/.env");
  console.log("Railway: set HEDERA_USDC_TOKEN_ID / HEDERA_AGENT_ID / HEDERA_AGENT_KEY / HEDERA_PROVIDER_ID as service variables.");
  process.exit(0);
}

main().catch((e) => {
  console.error("setup:hts error:", e?.message ?? e);
  process.exit(1);
});
