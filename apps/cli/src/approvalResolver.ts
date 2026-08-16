import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalResolver
} from "@fecode/models";
import {
  ChangeReviewFormatter,
  type ChangeReview,
  type ChangeReviewFile
} from "@fecode/agent";

export function formatApprovalRequest(request: ApprovalRequest): string {
  if (request.changeReview) {
    return ChangeReviewFormatter.format(
      request.changeReview as ChangeReview | ChangeReviewFile
    );
  }

  if (request.toolName === "execute_command") {
    const args = request.arguments as { command?: string } | undefined;
    const cmd = args?.command || "";
    return `⚠ FeCode wants to run a command\n\nCommand:\n  ${cmd}\n`;
  }

  return formatApprovalArguments(request.arguments);
}

export function formatApprovalArguments(
  args: unknown,
  maxStringLength: number = 80
): string {
  if (args === null || args === undefined) {
    return "{}";
  }

  if (typeof args !== "object") {
    const str = String(args);
    return str.length > maxStringLength
      ? str.slice(0, maxStringLength) + "..."
      : str;
  }

  const rec = args as Record<string, unknown>;

  if (typeof rec.diff === "string" && rec.diff) {
    const pathStr = typeof rec.path === "string" ? rec.path : "";
    const lines = rec.diff.split("\n");
    let displayDiff = rec.diff;
    if (lines.length > 30) {
      const half = 15;
      const top = lines.slice(0, half);
      const bottom = lines.slice(lines.length - half);
      const omitted = lines.length - 30;
      displayDiff = [...top, `... (${omitted} lines omitted) ...`, ...bottom].join("\n");
    }
    return `${pathStr ? `File:\n  ${pathStr}\n\n` : ""}Changes:\n${displayDiff}`;
  }

  const entries: string[] = [];
  for (const [key, value] of Object.entries(rec)) {
    if (typeof value === "string") {
      const displayVal =
        value.length > maxStringLength
          ? value.slice(0, maxStringLength) + "..."
          : value;
      entries.push(`${key}: ${displayVal}`);
    } else {
      const jsonStr = JSON.stringify(value);
      const displayVal =
        jsonStr.length > maxStringLength
          ? jsonStr.slice(0, maxStringLength) + "..."
          : jsonStr;
      entries.push(`${key}: ${displayVal}`);
    }
  }

  return entries.length > 0 ? entries.join("\n") : "{}";
}

export class InteractiveApprovalResolver implements ApprovalResolver {
  public onRequest?: (request: ApprovalRequest) => void;
  public pendingRequest?: ApprovalRequest;
  private pendingResolver?: (decision: ApprovalDecision) => void;

  async resolve(request: ApprovalRequest): Promise<ApprovalDecision> {
    if (this.pendingResolver) {
      this.cancelPending("Superseded by new approval request.");
    }

    this.pendingRequest = request;

    if (this.onRequest) {
      this.onRequest(request);
    }

    return new Promise<ApprovalDecision>((res) => {
      this.pendingResolver = res;
    });
  }

  submitDecision(input: string | boolean): void {
    if (!this.pendingResolver) {
      return;
    }

    const resolve = this.pendingResolver;
    this.pendingResolver = undefined;
    this.pendingRequest = undefined;

    if (typeof input === "boolean") {
      resolve(
        input
          ? { approved: true }
          : { approved: false, reason: "Tool execution was denied by the user." }
      );
      return;
    }

    const normalized = input.trim().toLowerCase();
    if (normalized === "y" || normalized === "yes") {
      resolve({ approved: true });
    } else {
      resolve({
        approved: false,
        reason: "Tool execution was denied by the user."
      });
    }
  }

  cancelPending(reason: string = "Approval request was cancelled."): void {
    if (!this.pendingResolver) {
      return;
    }

    const resolve = this.pendingResolver;
    this.pendingResolver = undefined;
    this.pendingRequest = undefined;

    resolve({
      approved: false,
      reason
    });
  }
}
