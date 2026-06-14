// [1/3] Give each agent a wallet.
// Uses Circle Programmable Wallets (developer-controlled) when CIRCLE_API_KEY +
// CIRCLE_ENTITY_SECRET are set; otherwise falls back to local ethers wallets that
// STAND IN for Circle PW so the rest of the demo (x402 settlement on Arc) can sign.
import "dotenv/config";
import { ethers } from "ethers";
import { fileURLToPath } from "node:url";
import path from "node:path";

export interface AgentWallet {
  id: string;
  address: string;
  privateKey?: string; // only present for the simulated/local stand-in
  custody: "circle-programmable" | "simulated-local";
}

export async function provisionAgentWallets(count = 2): Promise<AgentWallet[]> {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

  // ---- Real Circle Programmable Wallets path ----
  if (apiKey && entitySecret) {
    try {
      // Dynamic import so the SDK is NOT a hard dependency of the simulated path.
      // npm i @circle-fin/developer-controlled-wallets to enable this branch.
      const mod: any = await import("@circle-fin/developer-controlled-wallets");
      const client = mod.initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
      const ws = await client.createWalletSet({ name: "BoA Agents" });
      const walletSetId = ws.data.walletSet.id;
      const res = await client.createWallets({
        walletSetId,
        blockchains: ["ARC-TESTNET"],
        accountType: "EOA",
        count,
      });
      return (res.data.wallets as any[]).map((w) => ({
        id: w.id,
        address: w.address,
        custody: "circle-programmable" as const,
      }));
    } catch (e: any) {
      console.warn(`[wallets] Circle PW path failed (${e?.message || e}); using simulated wallets.`);
    }
  }

  // ---- Simulated fallback: reuse funded A/B from .env, else random ----
  console.log("[wallets] SIMULATE: Circle Programmable Wallets stand-ins (set CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET for real PW).");
  const envKeys = [process.env.PRIVATE_KEY_A, process.env.PRIVATE_KEY_B];
  const out: AgentWallet[] = [];
  for (let i = 0; i < count; i++) {
    const pk = envKeys[i];
    const w = pk ? new ethers.Wallet(pk) : ethers.Wallet.createRandom();
    out.push({ id: `sim-agent-${i + 1}`, address: w.address, privateKey: w.privateKey, custody: "simulated-local" });
  }
  return out;
}

// Standalone CLI: `npm run agent-wallets`
const isMain = !!process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  provisionAgentWallets(2).then((ws) => {
    console.log("Provisioned agent wallets:");
    for (const w of ws) console.log(`  ${w.id}  ${w.address}  [${w.custody}]`);
  });
}
