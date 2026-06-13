// The agent client. Calls the relay; on HTTP 402, pays the required USDC on Arc,
// then retries with an X-PAYMENT proof. This is the consumer side of x402.
import { ethers } from "ethers";
import { ARC, ERC20_ABI } from "./config";

export interface InferJob { prompt: string; maxTokens: number; }

export async function callRelayWithX402(relayUrl: string, agentPrivateKey: string, job: InferJob) {
  const provider = new ethers.JsonRpcProvider(ARC.rpcUrl);
  const wallet = new ethers.Wallet(agentPrivateKey, provider);
  const usdc = new ethers.Contract(ARC.usdc, ERC20_ABI, wallet);
  const body = JSON.stringify({ prompt: job.prompt, max_tokens: job.maxTokens });

  // 1) initial request -> expect 402 with payment requirements
  let r = await fetch(`${relayUrl}/infer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (r.status !== 402) throw new Error(`expected 402, got ${r.status}: ${await r.text()}`);
  const reqs: any = await r.json();
  const accept = reqs.accepts[0];
  const required = BigInt(accept.maxAmountRequired);

  // 2) settle: real USDC transfer agent -> relay on Arc
  const tx = await usdc.transfer(accept.payTo, required);
  await tx.wait();

  // 3) retry with X-PAYMENT proof
  const xpayment = Buffer.from(JSON.stringify({
    network: ARC.key,
    asset: accept.asset,
    payTo: accept.payTo,
    amount: required.toString(),
    txHash: tx.hash,
    from: wallet.address,
  })).toString("base64");

  r = await fetch(`${relayUrl}/infer`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-payment": xpayment },
    body,
  });
  if (!r.ok) throw new Error(`paid but relay returned ${r.status}: ${await r.text()}`);

  return { result: await r.json(), txHash: tx.hash, paid: required, payTo: accept.payTo as string };
}
