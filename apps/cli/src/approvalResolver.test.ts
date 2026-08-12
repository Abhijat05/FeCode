import { describe, it, expect, beforeEach } from "vitest";
import {
  InteractiveApprovalResolver,
  formatApprovalArguments
} from "./approvalResolver.js";
import type { ApprovalRequest } from "@fecode/models";

describe("InteractiveApprovalResolver", () => {
  let resolver: InteractiveApprovalResolver;
  const sampleRequest: ApprovalRequest = {
    id: "req-1",
    toolName: "mock_write",
    category: "write",
    arguments: { path: "src/App.tsx", content: "export const App = () => <div />;" },
    reason: "Tool 'mock_write' requires approval for write permission."
  };

  beforeEach(() => {
    resolver = new InteractiveApprovalResolver();
  });

  it("approves when user submits 'y', 'Y', 'yes', or 'YES'", async () => {
    const promise = resolver.resolve(sampleRequest);
    expect(resolver.pendingRequest).toEqual(sampleRequest);

    resolver.submitDecision("y");
    const decision = await promise;
    expect(decision).toEqual({ approved: true });
    expect(resolver.pendingRequest).toBeUndefined();
  });

  it("approves when user submits boolean true", async () => {
    const promise = resolver.resolve(sampleRequest);
    resolver.submitDecision(true);
    const decision = await promise;
    expect(decision).toEqual({ approved: true });
  });

  it("denies when user submits 'n', 'no', or empty string (Enter key)", async () => {
    const promise1 = resolver.resolve(sampleRequest);
    resolver.submitDecision("n");
    const decision1 = await promise1;
    expect(decision1.approved).toBe(false);

    const promise2 = resolver.resolve(sampleRequest);
    resolver.submitDecision("");
    const decision2 = await promise2;
    expect(decision2.approved).toBe(false);
  });

  it("defaults to deny for unexpected input strings", async () => {
    const promise = resolver.resolve(sampleRequest);
    resolver.submitDecision("maybe");
    const decision = await promise;
    expect(decision.approved).toBe(false);
    if (!decision.approved) {
      expect(decision.reason).toContain("denied");
    }
  });

  it("denies when cancelPending is called (e.g. Ctrl+C)", async () => {
    const promise = resolver.resolve(sampleRequest);
    resolver.cancelPending("Cancelled via Ctrl+C");
    const decision = await promise;
    expect(decision.approved).toBe(false);
    if (!decision.approved) {
      expect(decision.reason).toContain("Cancelled via Ctrl+C");
    }
  });

  it("notifies onRequest callback when resolve is called", async () => {
    let notifiedRequest: ApprovalRequest | undefined;
    resolver.onRequest = (req) => {
      notifiedRequest = req;
    };

    const promise = resolver.resolve(sampleRequest);
    expect(notifiedRequest).toEqual(sampleRequest);

    resolver.submitDecision("y");
    await promise;
  });
});

describe("formatApprovalArguments", () => {
  it("formats object arguments and truncates long strings", () => {
    const longContent = "a".repeat(200);
    const args = { path: "test.txt", content: longContent };
    const formatted = formatApprovalArguments(args, 50);

    expect(formatted).toContain("path: test.txt");
    expect(formatted).toContain("...");
    expect(formatted.length).toBeLessThan(longContent.length);
  });

  it("handles null or primitive arguments gracefully", () => {
    expect(formatApprovalArguments(null)).toBe("{}");
    expect(formatApprovalArguments(undefined)).toBe("{}");
    expect(formatApprovalArguments("just a string")).toBe("just a string");
  });
});
