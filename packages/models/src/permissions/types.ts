import type { Tool, ToolContext, ToolPermissionCategory } from "../tools/types.js";

export type PermissionDecision =
  | { type: "allowed" }
  | { type: "denied"; reason: string }
  | { type: "requires_approval"; reason: string };

export interface PermissionPolicy {
  checkPermission(tool: Tool, context: ToolContext): PermissionDecision;
}

export interface ApprovalRequest {
  id: string;
  toolName: string;
  category: ToolPermissionCategory;
  arguments?: unknown;
  reason?: string;
  changeReview?: unknown;
}

export type ApprovalDecision =
  | { approved: true }
  | { approved: false; reason?: string };

export interface ApprovalResolver {
  resolve(request: ApprovalRequest): Promise<ApprovalDecision>;
}

export interface PermissionManager {
  check(tool: Tool, context: ToolContext): Promise<PermissionDecision>;
}
