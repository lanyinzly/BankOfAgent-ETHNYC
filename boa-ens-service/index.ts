/**
 * boa-ens-service — ENS identity & discovery layer for Bank of Agent.
 *
 * Real ENS on Sepolia, nothing hard-coded: every name / address / record is read
 * live from the ENS registry + PublicResolver. Reuses the exact canonical
 * addresses / ABIs / flow proven in spikes/ens/src/register-and-write-sepolia.ts.
 *
 *   POST /agents   mints a REAL subname under FLEET_PARENT + writes text records
 *                  (Server-Sent Events: one event per on-chain step).
 *   GET  /agents   LIVE discovery — enumerates children purely from on-chain
 *                  NewOwner events (no database, no stored list).
 *   GET  /resolve  resolves any ENS name via the Universal Resolver.
 *   GET  /health   live chain id + fleet ownership check.
 *
 * No build step: Node 22 runs this .ts directly. `node boa-ens-service` works.
 */
import express from "express";
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  keccak256,
  namehash,
  labelhash,
  concat,
  toHex,
  parseAbi,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

// ── config (env-driven; defaults are the canonical Sepolia ENS addresses proven
//    in spikes/ens). Nothing about a specific fleet is hard-coded. ────────────
const PORT = Number(process.env.PORT || 8080);
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const ENS_REGISTRY = getAddress(process.env.ENS_REGISTRY || "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e");
const PUBLIC_RESOLVER = getAddress(process.env.PUBLIC_RESOLVER || "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5");
const CONTROLLER = getAddress(process.env.CONTROLLER || "0xdf60C561Ca35AD3C89D24BbA854654b1c3477078");
const FLEET_PARENT = (process.env.FLEET_PARENT || "ethglobal-ny-e372.eth").toLowerCase();
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
// Bound the discovery scan. Alchemy/Infura handle 0->latest in one call; public
// nodes cap the range, so we chunk. Set to the fleet's creation block to speed up.
const START_BLOCK = BigInt(process.env.BOA_ENS_START_BLOCK || "0");
const LOG_CHUNK = BigInt(process.env.BOA_ENS_LOG_CHUNK || "45000");

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const FLEET_NODE = namehash(FLEET_PARENT);

const registryAbi = parseAbi([
  "function owner(bytes32 node) view returns (address)",
  "function resolver(bytes32 node) view returns (address)",
  "function setSubnodeRecord(bytes32 node, bytes32 label, address owner, address resolver, uint64 ttl)",
]);
const resolverAbi = parseAbi([
  "function setAddr(bytes32 node, address a)",
  "function setText(bytes32 node, string key, string value)",
  "function addr(bytes32 node) view returns (address)",
  "function text(bytes32 node, string key) view returns (string)",
]);
const NEW_OWNER = parseAbiItem("event NewOwner(bytes32 indexed node, bytes32 indexed label, address owner)");

const pub = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC_URL) });

// The fleet-owner key lives ONLY here (server side). Optional: without it the
// service runs read-only (discovery + resolve still work; minting is disabled).
const PRIVATE_KEY = (process.env.PRIVATE_KEY || "").trim() as Hex | "";
const account = PRIVATE_KEY ? privateKeyToAccount(PRIVATE_KEY) : null;
const wallet = account
  ? createWalletClient({ account, chain: sepolia, transport: http(SEPOLIA_RPC_URL) })
  : null;

// Each agent gets its OWN deterministic identity address derived from its name.
function agentAddress(fullName: string): Address {
  return privateKeyToAccount(keccak256(toHex("boa-agent:" + fullName))).address;
}

function buildUsageRecord(fullName: string, model: string) {
  const usage = {
    agent: fullName,
    period: new Date().toISOString().slice(0, 10),
    model,
    requests: 0,
    tokensIn: 0,
    tokensOut: 0,
  };
  const digest = keccak256(toHex(JSON.stringify(usage)));
  return JSON.stringify({ ...usage, digest });
}

// childNode = namehash(`${label}.${FLEET_PARENT}`) = keccak256(parentNode ++ labelhash)
function childNode(parentNode: Hex, labelHash: Hex): Hex {
  return keccak256(concat([parentNode, labelHash]));
}

const ensLink = (name: string) => `https://sepolia.app.ens.domains/${name}`;
const txLink = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;
const addrLink = (a: string) => `https://sepolia.etherscan.io/address/${a}`;

// ── live discovery: NewOwner logs under the fleet node, chunked for public RPCs ─
async function discoverChildLabels(): Promise<Hex[]> {
  const latest = await pub.getBlockNumber();
  const labels: Hex[] = [];
  const seen = new Set<string>();
  const pushLogs = (logs: { args: { label?: Hex } }[]) => {
    for (const l of logs) {
      const lab = l.args.label;
      if (lab && !seen.has(lab)) {
        seen.add(lab);
        labels.push(lab);
      }
    }
  };
  // Fast path: one call (works on Alchemy/Infura). Fall back to chunking.
  try {
    pushLogs(
      (await pub.getLogs({
        address: ENS_REGISTRY,
        event: NEW_OWNER,
        args: { node: FLEET_NODE },
        fromBlock: START_BLOCK,
        toBlock: latest,
      })) as any,
    );
    return labels;
  } catch {
    /* range too large for this RPC — chunk below */
  }
  for (let from = START_BLOCK; from <= latest; from += LOG_CHUNK) {
    const to = from + LOG_CHUNK - 1n > latest ? latest : from + LOG_CHUNK - 1n;
    pushLogs(
      (await pub.getLogs({
        address: ENS_REGISTRY,
        event: NEW_OWNER,
        args: { node: FLEET_NODE },
        fromBlock: from,
        toBlock: to,
      })) as any,
    );
  }
  return labels;
}

async function readChild(labelHash: Hex) {
  const node = childNode(FLEET_NODE, labelHash);
  const resolver = getAddress(
    (await pub.readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: "resolver", args: [node] })) as Address,
  );
  if (resolver === ZERO) return null;
  const [address, boaUsage, description, avatar] = await Promise.all([
    pub.readContract({ address: resolver, abi: resolverAbi, functionName: "addr", args: [node] }).catch(() => ZERO),
    pub.readContract({ address: resolver, abi: resolverAbi, functionName: "text", args: [node, "boa.usage"] }).catch(() => ""),
    pub.readContract({ address: resolver, abi: resolverAbi, functionName: "text", args: [node, "description"] }).catch(() => ""),
    pub.readContract({ address: resolver, abi: resolverAbi, functionName: "text", args: [node, "avatar"] }).catch(() => ""),
  ]);
  let ensName = "";
  try {
    ensName = JSON.parse(boaUsage as string).agent || "";
  } catch {
    /* name lives in boa.usage.agent; if absent we surface the label hash */
  }
  if (!ensName) ensName = `(${(labelHash as string).slice(0, 10)}…).${FLEET_PARENT}`;
  return {
    ensName,
    address: address as Address,
    description: (description as string) || "",
    avatar: (avatar as string) || "",
    boaUsage: (boaUsage as string) || "",
    links: { ens: ensLink(ensName), etherscan: addrLink(address as string) },
  };
}

// ── HTTP ──────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const asyncH =
  (fn: (req: any, res: any) => Promise<void>) =>
  (req: any, res: any) =>
    fn(req, res).catch((e: Error) => {
      console.error(`[ens] ${req.method} ${req.path} ->`, e.message);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    });

app.get(
  "/health",
  asyncH(async (_req, res) => {
    const chainId = await pub.getChainId();
    let fleetOwner: string | null = null;
    let fleetOwnedByUs = false;
    try {
      fleetOwner = getAddress(
        (await pub.readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: "owner", args: [FLEET_NODE] })) as Address,
      );
      fleetOwnedByUs = !!account && fleetOwner === account.address;
    } catch {
      /* parent may not exist */
    }
    res.json({
      ok: true,
      service: "boa-ens-service",
      chainId,
      fleetParent: FLEET_PARENT,
      fleetNode: FLEET_NODE,
      resolver: PUBLIC_RESOLVER,
      registry: ENS_REGISTRY,
      controller: CONTROLLER,
      minting: !!wallet,
      account: account?.address ?? null,
      fleetOwner,
      fleetOwnedByUs,
      fleetLink: ensLink(FLEET_PARENT),
    });
  }),
);

// LIVE discovery — the prize-critical endpoint. No stored list.
app.get(
  "/agents",
  asyncH(async (_req, res) => {
    const labels = await discoverChildLabels();
    const children = await Promise.all(labels.map(readChild));
    res.json(children.filter(Boolean));
  }),
);

// Resolve ANY ENS name live via the Universal Resolver.
app.get(
  "/resolve",
  asyncH(async (req, res) => {
    const name = String(req.query.name || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    const address = await pub.getEnsAddress({ name }).catch(() => null);
    if (!address) return res.status(404).json({ name, address: null, error: "no resolved address" });
    const boaUsage = await pub.getEnsText({ name, key: "boa.usage" }).catch(() => null);
    res.json({ name, address, boaUsage, links: { ens: ensLink(name), etherscan: addrLink(address) } });
  }),
);

// Mint a subname under FLEET_PARENT and write records, streaming each step (SSE).
app.post("/agents", (req: any, res: any) => {
  const sse = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  (async () => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
    res.flushHeaders?.();

    if (!wallet || !account) {
      sse("error", { message: "minting disabled: no PRIVATE_KEY configured" });
      return res.end();
    }

    const name = String(req.body?.name || "").trim();
    const model = String(req.body?.model || "claude-opus-4-6");
    const description = String(req.body?.description || "");
    const label = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!label) {
      sse("error", { message: "invalid name" });
      return res.end();
    }
    const fullName = `${label}.${FLEET_PARENT}`;
    const node = namehash(fullName);

    // collision check — must be free on-chain (no mock)
    const existing = getAddress(
      (await pub.readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: "owner", args: [node] })) as Address,
    );
    if (existing !== ZERO) {
      sse("error", { message: `name taken: ${fullName}` });
      return res.end();
    }

    const wait = (hash: Hex) => pub.waitForTransactionReceipt({ hash });
    const send = (functionName: string, address: Address, abi: any, args: any[]) =>
      wallet.writeContract({ address, abi, functionName, args, account, chain: sepolia });

    sse("start", { ensName: fullName, fleetParent: FLEET_PARENT });

    // ① subname
    const subnameTx = await send("setSubnodeRecord", ENS_REGISTRY, registryAbi, [
      FLEET_NODE,
      labelhash(label),
      account.address,
      PUBLIC_RESOLVER,
      0n,
    ]);
    await wait(subnameTx);
    sse("step", { step: "subname", status: "done", txHash: subnameTx, link: txLink(subnameTx) });

    // ② address
    const agent = agentAddress(fullName);
    const addrTx = await send("setAddr", PUBLIC_RESOLVER, resolverAbi, [node, agent]);
    await wait(addrTx);
    sse("step", { step: "address", status: "done", txHash: addrTx, link: txLink(addrTx), address: agent });

    // ③ boa.usage
    const usageJson = buildUsageRecord(fullName, model);
    const usageTx = await send("setText", PUBLIC_RESOLVER, resolverAbi, [node, "boa.usage", usageJson]);
    await wait(usageTx);
    sse("step", { step: "usage", status: "done", txHash: usageTx, link: txLink(usageTx) });

    // ④ metadata (description + avatar)
    const avatar = `https://api.dicebear.com/9.x/bottts/svg?seed=${label}`;
    const descTx = await send("setText", PUBLIC_RESOLVER, resolverAbi, [node, "description", description]);
    await wait(descTx);
    const avatarTx = await send("setText", PUBLIC_RESOLVER, resolverAbi, [node, "avatar", avatar]);
    await wait(avatarTx);
    sse("step", { step: "metadata", status: "done", txHash: avatarTx, link: txLink(avatarTx) });

    sse("result", {
      ensName: fullName,
      address: agent,
      records: { "boa.usage": usageJson, description, avatar },
      links: { ens: ensLink(fullName), etherscan: txLink(subnameTx) },
    });
    res.end();
  })().catch((e: Error) => {
    console.error("[ens] POST /agents ->", e.message);
    try {
      sse("error", { message: e.message });
    } catch {
      /* ignore */
    }
    res.end();
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("  boa-ens-service — ENS identity & discovery (Sepolia)");
  console.log("  ───────────────────────────────────────────────────");
  console.log(`  listening     http://0.0.0.0:${PORT}`);
  console.log(`  rpc           ${SEPOLIA_RPC_URL}`);
  console.log(`  fleet parent  ${FLEET_PARENT}`);
  console.log(`  resolver      ${PUBLIC_RESOLVER}`);
  console.log(`  minting       ${wallet ? `enabled (${account!.address})` : "DISABLED (no PRIVATE_KEY — read-only)"}`);
  console.log("");
});
