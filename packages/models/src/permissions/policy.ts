import type { Tool, ToolContext } from "../tools/types.js";
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalResolver,
  PermissionDecision,
  PermissionManager,
  PermissionPolicy
} from "./types.js";

export class DefaultPermissionPolicy implements PermissionPolicy {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  checkPermission(tool: Tool, context: ToolContext): PermissionDecision {
    const category = tool.permissionCategory || "read";

    if (category === "read") {
      return { type: "allowed" };
    }

    return {
      type: "requires_approval",
      reason: `Tool '${tool.name}' requires approval for ${category} permission.`
    };
  }
}

export class DefaultPermissionManager implements PermissionManager {
  private readonly policy: PermissionPolicy;

  constructor(policy: PermissionPolicy = new DefaultPermissionPolicy()) {
    this.policy = policy;
  }

  async check(tool: Tool, context: ToolContext): Promise<PermissionDecision> {
    return this.policy.checkPermission(tool, context);
  }
}

export class AutoApproveResolver implements ApprovalResolver {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async resolve(request: ApprovalRequest): Promise<ApprovalDecision> {
    return { approved: true };
  }
}

export class AutoDenyResolver implements ApprovalResolver {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async resolve(request: ApprovalRequest): Promise<ApprovalDecision> {
    return { approved: false, reason: "Tool execution was denied by policy." };
  }
}
