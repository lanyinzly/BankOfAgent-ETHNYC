import "dotenv/config";
import { createHash } from "node:crypto";
import { ethers } from "ethers";
import { canonicalJSON } from "./receipt";

/**
 * HCS-14 Universal Agent ID (UAID) — on-chain agent identity.
 *
 * HCS-14 defines two methods: `uaid:did` (wraps an existing sovereign W3C DID, no new
 * hash) and `uaid:aid` (deterministic: identical canonical agent data → identical id,
 * uniqueness anchored by `nativeId` + `registry`). BoA agents don't carry a sovereign
 * DID, so we mint the deterministic **aid** method: sha-256 over the canonical agent
 * metadata, Base58-encoded, with the routing params appended.
 *
 *   uaid:aid:<base58(sha256(canonical))>;registry=…;proto=…;nativeId=hedera:testnet:0.0.x;uid=0
 *
 * The receipt's `agent_ens` (e.g. agent-a.boa.eth) and the agent's Hedera account become
 * one portable, verifiable identifier that survives across web2/web3. Derivation is pure
 * computation — it runs and verifies anywhere (no gRPC). With `--anchor` it also writes
 * the agent profile to an HCS registry topic (needs open gRPC egress).
 *
 * Spec: https://hol.org/docs/standards/hcs-14  (validate the exact param syntax against
 * the official @hashgraphonline/standards-sdk before production use).
 *
 * Run: cd spikes/hedera && npm run agent-id          # derive + print (works in sandbox)
 *      cd spikes/hedera && npm run agent-id -- --anchor   # also anchor to an HCS topic
 */

const NETWORK = "hedera:testnet";
const REGISTRY = "boa";
const PROTOCOL = "boa-router-receipts";

interface AgentMeta {
  registry: string;
  name: string;
  version: string;
  protocol: string;
  nativeId: string;
  skills: string[];
}

export function deriveUaid(meta: AgentMeta, uid = 0): { uaid: string; aid: string; canonical: string; sha256: string } {
  const canonical = canonicalJSON(meta as unknown as Record<string, unknown>);
  const digest = createHash("sha256").update(canonical).digest();
  const aid = ethers.encodeBase58(digest); // Base58, per HCS-14
  const uaid = `uaid:aid:${aid};registry=${meta.registry};proto=${meta.protocol};nativeId=${meta.nativeId};uid=${uid}`;
  return { uaid, aid, canonical, sha256: "0x" + digest.toString("hex") };
}

function agentMeta(name: string, account: string): AgentMeta {
  return {
    registry: REGISTRY,
    name,
    version: "1",
    protocol: PROTOCOL,
    nativeId: `${NETWORK}:${account}`,
    skills: ["inference", "usage-receipt", "x402-settle"],
  };
}

async function anchorToHcs(profiles: Array<{ name: string; uaid: string; meta: AgentMeta }>): Promise<void> {
  const { Client, PrivateKey, TopicCreateTransaction, TopicMessageSubmitTransaction, TopicId } = await import("@hashgraph/sdk");
  const id = process.env.HEDERA_OPERATOR_ID;
  const raw = process.env.HEDERA_OPERATOR_KEY;
  if (!id || !raw) throw new Error("--anchor needs HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY (open gRPC egress)");
  const parse = (r: string, t = "ED25519") => {
    try { return t.toUpperCase() === "ECDSA" ? PrivateKey.fromStringECDSA(r) : PrivateKey.fromStringED25519(r); } catch { return PrivateKey.fromStringDer(r); }
  };
  const key = parse(raw, process.env.HEDERA_OPERATOR_KEY_TYPE ?? "ED25519");
  const client = Client.forTestnet().setOperator(id, key);

  let topicId = process.env.HCS_AGENT_REGISTRY_TOPIC_ID || "";
  if (!topicId) {
    const resp = await new TopicCreateTransaction().setTopicMemo("BoA agent registry (HCS-14 UAIDs)").setAdminKey(key.publicKey).setSubmitKey(key.publicKey).execute(client);
    topicId = (await resp.getReceipt(client)).topicId!.toString();
    console.log(`[anchor] created registry topic ${topicId} (set HCS_AGENT_REGISTRY_TOPIC_ID to reuse)`);
  }
  for (const p of profiles) {
    const msg = JSON.stringify({ op: "register", uaid: p.uaid, ...p.meta });
    const r = await new TopicMessageSubmitTransaction().setTopicId(TopicId.fromString(topicId)).setMessage(msg).execute(client);
    const seq = (await r.getReceipt(client)).topicSequenceNumber!.toNumber();
    console.log(`[anchor] ${p.name} → topic ${topicId} seq ${seq}  https://hashscan.io/testnet/topic/${topicId}`);
  }
}

async function main(): Promise<void> {
  const account = process.env.HEDERA_OPERATOR_ID && !process.env.HEDERA_OPERATOR_ID.startsWith("0.0.xxx") ? process.env.HEDERA_OPERATOR_ID : "0.0.9186016";
  const agents = [
    { name: "agent-a.boa.eth", account },
    { name: "agent-b.boa.eth", account: process.env.HEDERA_PROVIDER_ID || account },
  ];

  console.log("\n=== HCS-14 Universal Agent IDs (uaid:aid) for BoA agents ===");
  const profiles = agents.map((a) => {
    const meta = agentMeta(a.name, a.account);
    const { uaid, aid, sha256 } = deriveUaid(meta);
    console.log(`\n${a.name}  (native ${meta.nativeId})`);
    console.log(`  sha256: ${sha256}`);
    console.log(`  uaid:   ${uaid}`);
    return { name: a.name, uaid, meta };
  });

  // Determinism check — derive twice, must match (this is the whole point of the aid method).
  const again = deriveUaid(agentMeta(agents[0].name, agents[0].account)).uaid;
  const deterministic = again === profiles[0].uaid;
  console.log(`\ndeterministic: ${deterministic ? "YES ✅ (same metadata → same UAID)" : "NO ❌"}`);

  if (process.argv.includes("--anchor")) {
    console.log("\n[anchor] writing agent profiles to an HCS registry topic…");
    await anchorToHcs(profiles);
  } else {
    console.log("\n(run with `--anchor` to also write these profiles to an HCS registry topic — needs gRPC egress)");
  }

  console.log(deterministic ? "\nPASS ✅  HCS-14 UAIDs derived (deterministic, Base58, anchored by nativeId+registry)." : "\nFAIL ❌");
  process.exit(deterministic ? 0 : 1);
}

main().catch((e) => {
  console.error("\nFAIL ❌ ", e);
  process.exit(1);
});
