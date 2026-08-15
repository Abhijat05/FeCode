export interface AgentPolicy {
  name: string;
  description: string;
  instructions: string[];
}

export interface AgentPolicyRegistry {
  register(policy: AgentPolicy): void;
  get(name: string): AgentPolicy | undefined;
  list(): AgentPolicy[];
  has(name: string): boolean;
}
