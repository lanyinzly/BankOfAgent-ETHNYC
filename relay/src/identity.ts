// Identity rail — STUB.
//
// Today: a static map of ENS name -> agent (address, api key, dev private key).
// Later: replaced by a real ENS resolver (agent-a.boa.eth -> address + records).
// The relay only ever talks to the IdentityProvider interface, so swapping the
// implementation does not touch any business logic.
//
// The two demo agents reuse the well-known public anvil test accounts (#1, #2)
// so that the OPTIONAL onchain mode also works out-of-the-box against `anvil`.
// These keys are public test keys — never use them for anything real.

import type { Agent, IdentityProvider } from "./types.ts";

const AGENTS: Agent[] = [
  {
    ens: "agent-a.boa.eth",
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    apiKey: "boa-sk-agent-a",
    privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  },
  {
    ens: "agent-b.boa.eth",
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    apiKey: "boa-sk-agent-b",
    privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  },
];

export class StaticIdentityProvider implements IdentityProvider {
  private byEns = new Map<string, Agent>();
  private byKey = new Map<string, Agent>();
  private byAddr = new Map<string, Agent>();

  constructor(agents: Agent[] = AGENTS) {
    for (const a of agents) {
      this.byEns.set(a.ens.toLowerCase(), a);
      this.byKey.set(a.apiKey, a);
      this.byAddr.set(a.address.toLowerCase(), a);
    }
  }

  resolveByBearer(token: string): Agent | null {
    if (!token) return null;
    const t = token.trim();
    return this.byKey.get(t) ?? this.byEns.get(t.toLowerCase()) ?? null;
  }

  getByEns(ens: string): Agent | null {
    return this.byEns.get(ens.toLowerCase()) ?? null;
  }

  getByAddress(address: string): Agent | null {
    return this.byAddr.get(address.toLowerCase()) ?? null;
  }

  // Accepts an ENS name OR a 0x address and returns the agent.
  resolve(handle: string): Agent | null {
    if (!handle) return null;
    if (handle.startsWith("0x") && handle.length === 42) return this.getByAddress(handle);
    return this.getByEns(handle);
  }

  list(): Agent[] {
    return [...this.byEns.values()];
  }
}
