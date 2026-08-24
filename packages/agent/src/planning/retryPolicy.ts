import type { ExecutionFeedbackKind, PlanStep, StepRetryPolicy } from "./types.js";

const DESTRUCTIVE_INTENT_TYPES = new Set<string>([
  "delete_file",
  "delete",
  "remove",
  "drop",
  "truncate",
  "destroy",
  "purge",
  "wipe"
]);

export interface StepRetryPolicyOptions {
  maxAttempts?: number;
  retryableFailures?: ExecutionFeedbackKind[];
  requiresFreshRiskAssessment?: boolean;
  requiresFreshPermission?: boolean;
}

export class DefaultStepRetryPolicy implements StepRetryPolicy {
  public readonly maxAttempts: number;
  public readonly retryableFailures: ExecutionFeedbackKind[];
  public readonly requiresFreshRiskAssessment: boolean;
  public readonly requiresFreshPermission: boolean;

  constructor(options: StepRetryPolicyOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 2;
    this.retryableFailures = options.retryableFailures ?? [
      "verification_failed",
      "tool_failure",
      "command_failure"
    ];
    this.requiresFreshRiskAssessment =
      options.requiresFreshRiskAssessment ?? true;
    this.requiresFreshPermission = options.requiresFreshPermission ?? true;
  }

  public isDestructive(step: PlanStep, opType?: string): boolean {
    if (step.intent && DESTRUCTIVE_INTENT_TYPES.has(step.intent.type)) {
      return true;
    }
    if (opType && DESTRUCTIVE_INTENT_TYPES.has(opType.toLowerCase())) {
      return true;
    }
    if (
      step.title.toLowerCase().includes("delete") ||
      step.title.toLowerCase().includes("remove file") ||
      step.title.toLowerCase().includes("wipe")
    ) {
      return true;
    }
    return false;
  }

  public canRetry(
    step: PlanStep,
    attemptCount: number,
    failureKind: ExecutionFeedbackKind,
    opType?: string
  ): boolean {
    // 1. Check bounded attempt count
    if (attemptCount >= this.maxAttempts) {
      return false;
    }

    // 2. Destructive operations MUST NEVER be automatically retried
    if (this.isDestructive(step, opType)) {
      return false;
    }

    // 3. Failure kind must be classified as retryable
    if (!this.retryableFailures.includes(failureKind)) {
      return false;
    }

    return true;
  }

  public getRemainingAttempts(
    _stepId: string,
    currentAttempts: number
  ): number {
    const remaining = this.maxAttempts - currentAttempts;
    return remaining > 0 ? remaining : 0;
  }
}
