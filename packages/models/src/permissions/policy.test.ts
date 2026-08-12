import { describe, it, expect } from "vitest";
import type { Tool, ToolContext } from "../tools/types.js";
import {
  DefaultPermissionPolicy,
  DefaultPermissionManager,
  AutoApproveResolver,
  AutoDenyResolver
} from "./policy.js";
import type { ApprovalRequest } from "./types.js";

describe("Permission Policy & Manager", () => {
  const dummyContext: ToolContext = {
    cwd: "/root",
    signal: new AbortController().signal
  };

  const readTool: Tool = {
    name: "read_file",
    description: "Read file",
    inputSchema: {},
    permissionCategory: "read",
    async execute() {
      return { success: true };
    }
  };

  const writeTool: Tool = {
    name: "write_file",
    description: "Write file",
    inputSchema: {},
    permissionCategory: "write",
    async execute() {
      return { success: true };
    }
  };

  const executeTool: Tool = {
    name: "run_command",
    description: "Execute shell command",
    inputSchema: {},
    permissionCategory: "execute",
    async execute() {
      return { success: true };
    }
  };

  const networkTool: Tool = {
    name: "http_request",
    description: "Network request",
    inputSchema: {},
    permissionCategory: "network",
    async execute() {
      return { success: true };
    }
  };

  it("DefaultPermissionPolicy allows read category automatically", () => {
    const policy = new DefaultPermissionPolicy();
    const decision = policy.checkPermission(readTool, dummyContext);
    expect(decision).toEqual({ type: "allowed" });
  });

  it("DefaultPermissionPolicy defaults to read category if omitted", () => {
    const policy = new DefaultPermissionPolicy();
    const untypedTool: Tool = {
      name: "legacy_tool",
      description: "No category",
      inputSchema: {},
      async execute() {
        return { success: true };
      }
    };
    const decision = policy.checkPermission(untypedTool, dummyContext);
    expect(decision).toEqual({ type: "allowed" });
  });

  it("DefaultPermissionPolicy requires approval for write, execute, and network categories", () => {
    const policy = new DefaultPermissionPolicy();

    const writeDecision = policy.checkPermission(writeTool, dummyContext);
    expect(writeDecision.type).toBe("requires_approval");

    const execDecision = policy.checkPermission(executeTool, dummyContext);
    expect(execDecision.type).toBe("requires_approval");

    const netDecision = policy.checkPermission(networkTool, dummyContext);
    expect(netDecision.type).toBe("requires_approval");
  });

  it("DefaultPermissionManager delegates to PermissionPolicy", async () => {
    const manager = new DefaultPermissionManager();

    const readDecision = await manager.check(readTool, dummyContext);
    expect(readDecision.type).toBe("allowed");

    const writeDecision = await manager.check(writeTool, dummyContext);
    expect(writeDecision.type).toBe("requires_approval");
  });

  it("AutoApproveResolver approves all requests", async () => {
    const resolver = new AutoApproveResolver();
    const request: ApprovalRequest = {
      id: "req-1",
      toolName: "write_file",
      category: "write"
    };
    const decision = await resolver.resolve(request);
    expect(decision).toEqual({ approved: true });
  });

  it("AutoDenyResolver denies all requests", async () => {
    const resolver = new AutoDenyResolver();
    const request: ApprovalRequest = {
      id: "req-1",
      toolName: "write_file",
      category: "write"
    };
    const decision = await resolver.resolve(request);
    expect(decision).toEqual({ approved: false, reason: "Tool execution was denied by policy." });
  });
});
