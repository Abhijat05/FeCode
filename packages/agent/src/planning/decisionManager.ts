import type {
  ExecutionDecision,
  ExecutionDecisionManager,
  ExecutionDecisionRequest,
  ExecutionDecisionResult,
  TaskPlan
} from "./types.js";
import { getFirstIncompleteStep } from "./taskPlan.js";

function normalizeDecision(input: string | ExecutionDecision): ExecutionDecision {
  const normalized = String(input).trim().toLowerCase();
  if (normalized === "c" || normalized === "continue") return "continue";
  if (normalized === "r" || normalized === "replan") return "replan";
  if (normalized === "x" || normalized === "cancel") return "cancel";
  return "cancel"; // default
}

export class DefaultExecutionDecisionManager implements ExecutionDecisionManager {
  private readonly activeRequests = new Map<string, ExecutionDecisionRequest>();
  private readonly decisionIndex = new Map<string, string>(); // planId/runId -> decisionId
  private readonly resolvedResults = new Map<string, ExecutionDecisionResult>();

  public createDecisionRequest(params: {
    decisionId?: string;
    runId: string;
    planId: string;
    blockedStepId: string;
    affectedStepIds?: string[];
    reason: string;
    allowedDecisions?: ExecutionDecision[];
    defaultDecision?: ExecutionDecision;
    requestedAt?: number;
  }): ExecutionDecisionRequest {
    const decisionId =
      params.decisionId ||
      `dec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const request: ExecutionDecisionRequest = Object.freeze({
      decisionId,
      runId: params.runId,
      planId: params.planId,
      blockedStepId: params.blockedStepId,
      affectedStepIds: params.affectedStepIds || [params.blockedStepId],
      reason: params.reason,
      requestedAt: params.requestedAt || Date.now(),
      allowedDecisions: params.allowedDecisions || (["continue", "replan", "cancel"] as ExecutionDecision[]),
      defaultDecision: params.defaultDecision || "cancel"
    });

    this.activeRequests.set(decisionId, request);
    this.decisionIndex.set(params.planId, decisionId);
    this.decisionIndex.set(params.runId, decisionId);

    return request;
  }

  public async resolveDecision(
    requestOrDecisionId: string | ExecutionDecisionRequest,
    decision: ExecutionDecision | string,
    options?: {
      cwd?: string;
      userRequest?: string;
      plan?: TaskPlan;
    }
  ): Promise<ExecutionDecisionResult> {
    const decisionId =
      typeof requestOrDecisionId === "string"
        ? (this.decisionIndex.get(requestOrDecisionId) || requestOrDecisionId)
        : requestOrDecisionId.decisionId;

    const request = this.activeRequests.get(decisionId);
    if (!request) {
      const existing = this.resolvedResults.get(decisionId);
      if (existing) {
        return {
          decisionId,
          decision: existing.decision,
          accepted: false,
          resultingPlanId: existing.resultingPlanId,
          resultingRunId: existing.resultingRunId,
          cancelled: existing.cancelled,
          reason: `Decision ${decisionId} was already resolved.`,
          resolvedAt: Date.now()
        };
      }
      return {
        decisionId,
        decision: "cancel",
        accepted: false,
        cancelled: true,
        reason: `No active decision request found for ID ${decisionId}.`,
        resolvedAt: Date.now()
      };
    }

    const normalized = normalizeDecision(decision);
    if (!request.allowedDecisions.includes(normalized)) {
      return {
        decisionId: request.decisionId,
        decision: normalized,
        accepted: false,
        cancelled: normalized === "cancel",
        reason: `Decision "${normalized}" is not allowed for request ${request.decisionId}.`,
        resolvedAt: Date.now()
      };
    }

    // Atomically remove from active requests
    this.activeRequests.delete(request.decisionId);
    this.decisionIndex.delete(request.planId);
    this.decisionIndex.delete(request.runId);

    let result: ExecutionDecisionResult;

    if (normalized === "continue") {
      let resumedStepId = request.blockedStepId;
      let resumedStepOrder: number | undefined;

      if (options?.plan) {
        const incomplete = getFirstIncompleteStep(options.plan);
        if (incomplete) {
          resumedStepId = incomplete.stepId;
          resumedStepOrder = incomplete.order;
        }
      }

      result = Object.freeze({
        decisionId: request.decisionId,
        decision: "continue",
        accepted: true,
        resultingPlanId: request.planId,
        resultingRunId: request.runId,
        resumedStepId,
        resumedStepOrder,
        cancelled: false,
        reason: "Continuing plan execution from first incomplete step",
        resolvedAt: Date.now()
      });
    } else if (normalized === "replan") {
      result = Object.freeze({
        decisionId: request.decisionId,
        decision: "replan",
        accepted: true,
        resultingRunId: request.runId,
        cancelled: false,
        reason: "Replanning requested by user",
        resolvedAt: Date.now()
      });
    } else {
      result = Object.freeze({
        decisionId: request.decisionId,
        decision: "cancel",
        accepted: true,
        resultingPlanId: request.planId,
        resultingRunId: request.runId,
        cancelled: true,
        reason: "Execution cancelled by user",
        resolvedAt: Date.now()
      });
    }

    this.resolvedResults.set(request.decisionId, result);
    return result;
  }

  public getActiveRequest(planIdOrRunId: string): ExecutionDecisionRequest | undefined {
    const id = this.decisionIndex.get(planIdOrRunId) || planIdOrRunId;
    return this.activeRequests.get(id);
  }

  public getDecisionResult(decisionId: string): ExecutionDecisionResult | undefined {
    return this.resolvedResults.get(decisionId);
  }

  public clear(planIdOrRunId?: string): void {
    if (!planIdOrRunId) {
      this.activeRequests.clear();
      this.decisionIndex.clear();
      this.resolvedResults.clear();
      return;
    }

    const decisionId = this.decisionIndex.get(planIdOrRunId) || planIdOrRunId;
    const req = this.activeRequests.get(decisionId);
    if (req) {
      this.activeRequests.delete(req.decisionId);
      this.decisionIndex.delete(req.planId);
      this.decisionIndex.delete(req.runId);
    }
  }
}
