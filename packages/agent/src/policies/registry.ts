import type { AgentPolicy, AgentPolicyRegistry } from "./types.js";
import { DEFAULT_CODING_POLICY } from "./defaultCodingPolicy.js";

export class DefaultAgentPolicyRegistry implements AgentPolicyRegistry {
  private readonly policies: Map<string, AgentPolicy> = new Map();

  constructor() {
    this.register(DEFAULT_CODING_POLICY);
  }

  public register(policy: AgentPolicy): void {
    this.policies.set(policy.name, policy);
  }

  public get(name: string): AgentPolicy | undefined {
    return this.policies.get(name);
  }

  public list(): AgentPolicy[] {
    return Array.from(this.policies.values());
  }

  public has(name: string): boolean {
    return this.policies.has(name);
  }
}
