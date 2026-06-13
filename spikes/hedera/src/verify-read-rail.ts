import "dotenv/config";

/**
 * Proves the *read* half of the proof rail is live on testnet WITHOUT an operator
 * account: find a recent successful ConsensusSubmitMessage on the network, then
 * read + base64-decode that message back from the mirror node REST API.
 *
 * This is the half of the spike that needs no credentials, so it always runs green
 * as long as testnet + the mirror node are up. The write half (create topic +
 * submit) needs a funded operator account — see `npm run spike`.
 */

const MIRROR = process.env.HEDERA_MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";

async function main(): Promise<void> {
  console.log("\n=== verify mirror-node READ rail (live testnet, no credentials needed) ===");
  console.log(`mirror node: ${MIRROR}`);

  const txRes = await fetch(
    `${MIRROR}/api/v1/transactions?transactiontype=consensussubmitmessage&result=success&limit=1&order=desc`,
  );
  const txJson: any = await txRes.json();
  const tx = txJson.transactions?.[0];
  if (!tx?.entity_id) {
    console.log("FAIL ❌  no recent ConsensusSubmitMessage transactions found.");
    process.exit(1);
  }
  const topicId: string = tx.entity_id;
  console.log(`found a live topic with a recent message: ${topicId}`);

  const msgRes = await fetch(`${MIRROR}/api/v1/topics/${topicId}/messages?limit=1&order=desc`);
  const msgJson: any = await msgRes.json();
  const m = msgJson.messages?.[0];
  if (!m) {
    console.log("FAIL ❌  topic returned no messages.");
    process.exit(1);
  }

  const bytes = Buffer.from(m.message, "base64");
  console.log(`topic_id: ${m.topic_id}  sequence_number: ${m.sequence_number}  consensus_timestamp: ${m.consensus_timestamp}`);
  console.log(`message read back + base64-decoded OK: ${bytes.length} bytes`);
  console.log(`hashscan: https://hashscan.io/testnet/topic/${topicId}`);
  console.log("\nPASS ✅  mirror-node read + base64-decode rail is live on testnet.");
}

main().catch((e) => {
  console.error("FAIL ❌", e);
  process.exit(1);
});
