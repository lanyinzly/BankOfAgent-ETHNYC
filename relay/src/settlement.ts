// Settlement rail — STUB.
//
// Today: a mock USDC ledger in memory. settle() debits the agent's mock balance
// and returns a fake but well-formed settlement tx hash.
// Later: replaced by Arc (real USDC, pay-per-call). The relay only depends on
// the SettlementProvider interface.

import { createHash } from "node:crypto";
import type { Agent, SettlementProvider, SettlementResult } from "./types.ts";

const STARTING_BALANCE_USDC = 100;

export class MockUsdcSettlement implements SettlementProvider {
  private balances = new Map<string, number>();
  private nonce = 0;
  private startingBalance: number;

  constructor(startingBalance = STARTING_BALANCE_USDC) {
    this.startingBalance = startingBalance;
  }

  balanceOf(agent: Agent): number {
    const key = agent.address.toLowerCase();
    if (!this.balances.has(key)) this.balances.set(key, this.startingBalance);
    return this.balances.get(key)!;
  }

  settle(agent: Agent, amountUsdc: number, memo: string): SettlementResult {
    const key = agent.address.toLowerCase();
    const bal = this.balanceOf(agent);
    const after = Math.max(0, round6(bal - amountUsdc));
    this.balances.set(key, after);

    const nonce = this.nonce++;
    // Deterministic, 32-byte, 0x-prefixed pseudo tx hash so it looks like a real
    // settlement reference in receipts/logs.
    const settlement_tx =
      "0x" +
      createHash("sha256")
        .update(`${agent.address}:${amountUsdc}:${memo}:${nonce}`)
        .digest("hex");

    return { settlement_tx, amount_usdc: round6(amountUsdc), balance_after: after };
  }
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
