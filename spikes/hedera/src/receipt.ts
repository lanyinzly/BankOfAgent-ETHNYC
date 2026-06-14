import { ethers } from "ethers";
import { createHash, randomUUID } from "node:crypto";

/**
 * A router-signed usage receipt — the unit BoA writes to its proof rail.
 *
 * Narrative: HCS does not prove "real consumption", it proves *a signed claim of
 * consumption that cannot be tampered with*. So we never submit a raw log line —
 * we submit one of these: every agent call becomes a signed, immutable receipt.
 *
 * The message body submitted to HCS is exactly this schema (no extra fields).
 */
export interface UsageReceipt {
  request_id: string;
  agent_ens: string;
  membership_token_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_cost_usdc: string; // string, not float, to avoid drift across the wire
  settlement_tx: string; // Arc / USDC settlement tx hash
  price_before: string; // FOAMM voucher premium before this call
  price_after: string; // FOAMM voucher premium after this call
  router_signature: string; // EIP-191 sig over canonical(receipt minus this field)
}

export type UnsignedReceipt = Omit<UsageReceipt, "router_signature">;

/** Deterministic JSON: keys sorted, no whitespace. These are the bytes we sign & digest. */
export function canonicalJSON(obj: Record<string, unknown>): string {
  const ordered: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) ordered[k] = obj[k];
  return JSON.stringify(ordered);
}

/** The exact bytes the router signs: the receipt without its own signature. */
export function signingPayload(r: UnsignedReceipt): string {
  return canonicalJSON(r as unknown as Record<string, unknown>);
}

/** Router-sign an unsigned receipt (EIP-191 personal_sign over the canonical payload). */
export async function signReceipt(
  unsigned: UnsignedReceipt,
  routerKey: ethers.Wallet,
): Promise<UsageReceipt> {
  const router_signature = await routerKey.signMessage(signingPayload(unsigned));
  return { ...unsigned, router_signature };
}

/** Recover the router address from a receipt's signature — anyone can do this, no secret needed. */
export function verifyReceipt(r: UsageReceipt): string {
  const { router_signature, ...unsigned } = r;
  return ethers.verifyMessage(signingPayload(unsigned), router_signature);
}

/** sha-256 over the full canonical receipt (incl. signature) — the immutability anchor / digest. */
export function receiptDigest(r: UsageReceipt): string {
  return "0x" + createHash("sha256").update(canonicalJSON(r as unknown as Record<string, unknown>)).digest("hex");
}

/** A realistic sample receipt for the spike. request_id is randomized per run. */
export function sampleUnsignedReceipt(): UnsignedReceipt {
  return {
    request_id: "req_" + randomUUID(),
    agent_ens: "agent-a.boa.eth",
    membership_token_id: "7527",
    model: "openai/gpt-4o-2024-08-06",
    input_tokens: 1843,
    output_tokens: 512,
    total_cost_usdc: "0.004212",
    settlement_tx: "0x" + "ab".repeat(32),
    price_before: "1.0000",
    price_after: "1.0007",
  };
}
