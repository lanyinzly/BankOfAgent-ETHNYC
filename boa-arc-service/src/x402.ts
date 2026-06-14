// x402 buyer client (consumer side). POST /infer → read 402 → pay the DISCOVERED
// price in USDC on Arc → retry with an X-PAYMENT proof. Mirrors the proven
// spikes/arc/src/agentic/agent.ts, but pays the FOAMM-quoted amount (>= the
// relay's floor) so the on-chain settlement equals the demand-discovered price.
import { ethers } from "ethers";
import { ARC, ERC20_ABI } from "./arc.ts";

export interface BuyArgs {
  relayUrl: string;
  agentKey: string;
  payUnits: bigint; // the discovered (FOAMM) price in USDC base units
  prompt: string;
  maxTokens: number;
}
export interface BuyOut {
  result: any;
  txHash: string;
  payTo: string;
  paid: bigint;
  floorRequired: bigint;
}

export async function buyWithX402(a: BuyArgs): Promise<BuyOut> {
  const provider = new ethers.JsonRpcProvider(ARC.rpcUrl);
  const wallet = new ethers.Wallet(a.agentKey, provider);
  const usdc = new ethers.Contract(ARC.usdc, ERC20_ABI, wallet);
  const body = JSON.stringify({ prompt: a.prompt, max_tokens: a.maxTokens });

  // 1) initial request -> 402 with payment requirements
  let r = await fetch(`${a.relayUrl}/infer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (r.status !== 402) throw new Error(`expected 402, got ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const reqs: any = await r.json();
  const accept = reqs.accepts?.[0];
  if (!accept) throw new Error("relay 402 had no accepts[]");
  const floor = BigInt(accept.maxAmountRequired);
  const pay = a.payUnits >= floor ? a.payUnits : floor; // discovered price, never below floor

  // 2) settle on Arc — real USDC transfer agent -> seller
  const tx = await usdc.transfer(accept.payTo, pay);
  await tx.wait();

  // 3) retry with the X-PAYMENT proof
  const xpayment = Buffer.from(
    JSON.stringify({
      network: ARC.key,
      asset: accept.asset,
      payTo: accept.payTo,
      amount: pay.toString(),
      txHash: tx.hash,
      from: wallet.address,
    }),
  ).toString("base64");
  r = await fetch(`${a.relayUrl}/infer`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-payment": xpayment },
    body,
  });
  if (!r.ok) throw new Error(`paid but relay returned ${r.status}: ${(await r.text()).slice(0, 200)}`);

  return { result: await r.json(), txHash: tx.hash, payTo: accept.payTo as string, paid: pay, floorRequired: floor };
}
