// Proof rail — STUB.
//
// Today: every metered call produces a usage receipt that the router SIGNS with
// its local key, then we append it to a JSONL file (and keep it in memory).
// Later: the same signed receipt is published to a Hedera HCS topic. Swapping the
// sink does not change the receipt schema or the signature.
//
// The narrative this enables: every call == one signed usage receipt.

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem/accounts";
import type { ProofSink, UsageReceipt } from "./types.ts";

// Stable JSON (sorted keys) so the signed payload is reproducible/verifiable.
function stable(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  return JSON.stringify(obj, keys);
}

export class SignedReceiptProof implements ProofSink {
  private account: PrivateKeyAccount;
  private receipts: UsageReceipt[] = [];
  private file: string;

  constructor(routerPrivateKey: `0x${string}`, file: string) {
    this.file = file;
    this.account = privateKeyToAccount(routerPrivateKey);
    // Recover any receipts from a previous run so /boa/usage survives restarts.
    if (existsSync(file)) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (line.trim()) {
          try {
            this.receipts.push(JSON.parse(line));
          } catch {
            /* skip malformed line */
          }
        }
      }
    }
  }

  get routerAddress(): `0x${string}` {
    return this.account.address;
  }

  async record(body: Omit<UsageReceipt, "router_signature">): Promise<UsageReceipt> {
    const payload = stable(body as unknown as Record<string, unknown>);
    const router_signature = await this.account.signMessage({ message: payload });
    const receipt: UsageReceipt = { ...body, router_signature };

    this.receipts.push(receipt);
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, JSON.stringify(receipt) + "\n");
    } catch (e) {
      console.warn(`[proof] could not persist receipt: ${(e as Error).message}`);
    }
    return receipt;
  }

  list(agentEns?: string): UsageReceipt[] {
    if (!agentEns) return [...this.receipts];
    const ens = agentEns.toLowerCase();
    return this.receipts.filter((r) => r.agent_ens.toLowerCase() === ens);
  }
}
