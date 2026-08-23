import type {
  ReplanAssessment,
  ReplanManager,
  ReplanManagerOptions,
  ReplanReason,
  ReplanRequest,
  ReplanResult,
  TaskPlan
} from "./types.js";
import {
  captureWorkspaceFingerprint,
  compareWorkspaceFingerprints
} from "../history/workspaceFingerprint.js";
import { createTaskPlan } from "./taskPlan.js";

export class DefaultReplanManager implements ReplanManager {
  private readonly options: ReplanManagerOptions;
  private readonly maxReplanDepth: number;
  private readonly planStore = new Map<string, TaskPlan>();

  constructor(options: ReplanManagerOptions) {
    this.options = options;
    this.maxReplanDepth = options.maxReplanDepth ?? 5;
  }

  public registerPlan(plan: TaskPlan): void {
    this.planStore.set(plan.planId, plan);
  }

  public async getPlan(planId: string): Promise<TaskPlan | null> {
    if (this.planStore.has(planId)) {
      return this.planStore.get(planId)!;
    }

    // Check diagnostics manager
    if (this.options.diagnosticsManager) {
      const summary = this.options.diagnosticsManager.getRunSummary(planId);
      if (summary && summary.planId === planId) {
        // Construct reconstructed plan metadata if in diagnostics
        return createTaskPlan({
          planId: summary.planId,
          runId: summary.runId,
          userRequestSummary: summary.userRequestSummary,
          objective: summary.planSummary || summary.userRequestSummary,
          steps: [],
          status: summary.planStatus || "superseded",
          replanCount: summary.replanCount,
          parentPlanId: summary.parentPlanId,
          replanDepth: summary.replanDepth,
          replanReason: summary.replanReason
        });
      }
    }

    // Check history store
    if (this.options.historyStore) {
      try {
        const historicalRun = await this.options.historyStore.getRun(planId);
        if (historicalRun && historicalRun.planId) {
          return createTaskPlan({
            planId: historicalRun.planId,
            runId: historicalRun.runId,
            userRequestSummary: historicalRun.userRequestSummary,
            objective: historicalRun.planSummary || historicalRun.userRequestSummary,
            steps: [],
            status: historicalRun.planStatus || "superseded",
            replanCount: historicalRun.replanCount,
            parentPlanId: historicalRun.parentPlanId,
            replanDepth: historicalRun.replanDepth,
            replanReason: historicalRun.replanReason
          });
        }

        // Also check by runId query
        const allRuns = await this.options.historyStore.listRuns();
        const matchingRun = allRuns.find((r) => r.planId === planId);
        if (matchingRun && matchingRun.planId) {
          return createTaskPlan({
            planId: matchingRun.planId,
            runId: matchingRun.runId,
            userRequestSummary: matchingRun.userRequestSummary,
            objective: matchingRun.planSummary || matchingRun.userRequestSummary,
            steps: [],
            status: matchingRun.planStatus || "superseded",
            replanCount: matchingRun.replanCount,
            parentPlanId: matchingRun.parentPlanId,
            replanDepth: matchingRun.replanDepth,
            replanReason: matchingRun.replanReason
          });
        }
      } catch {
        // Non-fatal store lookup error
      }
    }

    return null;
  }

  public async assessReplanning(
    request: ReplanRequest
  ): Promise<ReplanAssessment> {
    const previousPlan = await this.getPlan(request.previousPlanId);
    const previousDepth = previousPlan?.replanDepth ?? 0;
    const currentDepth = previousDepth + 1;
    const isLimitReached = currentDepth > this.maxReplanDepth;

    if (isLimitReached) {
      return {
        eligible: false,
        reason: "REPLAN_LIMIT_REACHED",
        explanation: `Replanning limit reached (depth ${previousDepth}/${this.maxReplanDepth}). Please create a fresh task.`,
        previousPlanId: request.previousPlanId,
        workspaceChanged: false,
        riskChanged: false,
        planStale: true,
        requiresUserConfirmation: false,
        replanDepth: currentDepth,
        maxReplanDepth: this.maxReplanDepth,
        isLimitReached: true,
        previousPlan: previousPlan || undefined
      };
    }

    // 1. Capture current workspace fingerprint
    const trackedFiles: string[] = [];
    if (previousPlan) {
      for (const s of previousPlan.steps) {
        if (s.expectedFiles) trackedFiles.push(...s.expectedFiles);
        if (s.intent?.target) trackedFiles.push(s.intent.target);
      }
    }

    let currentFingerprint;
    let workspaceChanged = false;
    let workspaceDiffReasons: string[] = [];

    try {
      currentFingerprint = await captureWorkspaceFingerprint(
        request.cwd,
        trackedFiles,
        this.options.gitRepository
      );

      if (request.currentWorkspaceFingerprint) {
        const diff = compareWorkspaceFingerprints(
          request.currentWorkspaceFingerprint,
          currentFingerprint
        );
        workspaceChanged = !diff.matches;
        workspaceDiffReasons = diff.reasons;
      }
    } catch {
      // Non-fatal fingerprint error
    }

    // 2. Re-evaluate task risk
    const userMessage =
      request.userRequest ||
      previousPlan?.userRequestSummary ||
      "Replanning task execution";

    const reassessedRisk = this.options.executionPolicy.assess({
      userMessage,
      cwd: request.cwd,
      affectedFiles: trackedFiles,
      operations: []
    });

    const riskChanged = Boolean(
      previousPlan?.risks &&
        previousPlan.risks.length > 0 &&
        previousPlan.risks[0].level !== reassessedRisk.level
    );

    // 3. Re-evaluate active skills
    let reassessedSkills: string[] = [];
    if (this.options.skillRegistry && this.options.activationPolicy) {
      const activation = this.options.activationPolicy.activate(
        userMessage,
        this.options.skillRegistry,
        this.options.projectContext
      );
      reassessedSkills = activation.skills.map((s) => s.name);
    } else if (this.options.skillRegistry) {
      reassessedSkills = this.options.skillRegistry.list().map((s) => s.name);
    }

    // 4. Plan staleness and eligibility determination
    const planStale = Boolean(
      previousPlan?.status === "superseded" ||
        request.reason === "stale_workspace" ||
        request.reason === "plan_invalidated" ||
        workspaceChanged
    );

    const affectedStepId =
      request.failedStepId ||
      previousPlan?.steps.find((s) => s.status === "failed")?.stepId;

    const explanation =
      request.explanation ||
      (workspaceChanged
        ? `Workspace state drifted: ${workspaceDiffReasons.join("; ")}`
        : affectedStepId
          ? `Step ${affectedStepId} failed during execution`
          : previousPlan?.invalidationReason || `Replanning requested: ${request.reason}`);

    return {
      eligible: true,
      reason: request.reason,
      explanation,
      previousPlanId: request.previousPlanId,
      affectedStepId,
      workspaceChanged,
      workspaceDiffReasons,
      riskChanged,
      planStale,
      requiresUserConfirmation: true,
      replanDepth: currentDepth,
      maxReplanDepth: this.maxReplanDepth,
      isLimitReached: false,
      currentFingerprint,
      reassessedRisk,
      reassessedSkills,
      previousPlan: previousPlan || undefined
    };
  }

  public async prepareReplan(
    planIdOrRunId: string,
    options: {
      cwd: string;
      userRequest?: string;
      reason?: ReplanReason | string;
      explanation?: string;
      failedStepId?: string;
    }
  ): Promise<ReplanAssessment> {
    const request: ReplanRequest = {
      runId: `run-replan-${Date.now()}`,
      previousPlanId: planIdOrRunId,
      reason: options.reason || "user_requested",
      explanation: options.explanation,
      failedStepId: options.failedStepId,
      cwd: options.cwd,
      userRequest: options.userRequest || "",
      requestedBy: "user"
    };

    return this.assessReplanning(request);
  }

  public async executeReplan(request: ReplanRequest): Promise<ReplanResult> {
    const now = Date.now();
    const assessment = await this.assessReplanning(request);

    if (!assessment.eligible || assessment.isLimitReached) {
      return {
        previousPlanId: request.previousPlanId,
        status: assessment.isLimitReached ? "limit_reached" : "failed",
        reason: assessment.explanation || String(assessment.reason),
        createdAt: now,
        replanDepth: assessment.replanDepth
      };
    }

    const previousPlan = assessment.previousPlan;
    const userMessage =
      request.userRequest ||
      previousPlan?.userRequestSummary ||
      "Adapted task execution";

    const affectedFiles: string[] = [];
    if (previousPlan) {
      for (const s of previousPlan.steps) {
        if (s.expectedFiles) affectedFiles.push(...s.expectedFiles);
        if (s.intent?.target) affectedFiles.push(s.intent.target);
      }
    }

    const newPlanId = `plan-${now}-${Math.random().toString(36).substring(2, 7)}`;
    const rootPlanId =
      previousPlan?.rootPlanId ||
      previousPlan?.parentPlanId ||
      request.previousPlanId;

    // Create fresh plan using current reality
    const newPlan = await this.options.planner.createPlan({
      runId: request.runId,
      userMessage,
      cwd: request.cwd,
      activeSkills: assessment.reassessedSkills,
      authoritativeRisk: assessment.reassessedRisk?.level || "normal",
      affectedFiles: Array.from(new Set(affectedFiles))
    });

    const adaptedPlan: TaskPlan = {
      ...newPlan,
      planId: newPlanId,
      runId: request.runId,
      parentPlanId: request.previousPlanId,
      rootPlanId,
      replanDepth: assessment.replanDepth,
      replanReason: String(request.reason),
      replanCount: (previousPlan?.replanCount ?? 0) + 1,
      status: "ready"
    };

    // Store in planStore and diagnostics
    this.registerPlan(adaptedPlan);
    if (this.options.diagnosticsManager) {
      this.options.diagnosticsManager.recordPlan(request.runId, adaptedPlan);
    }

    return {
      previousPlanId: request.previousPlanId,
      newPlanId: adaptedPlan.planId,
      status: "created",
      reason: String(request.reason),
      createdAt: now,
      newPlan: adaptedPlan,
      replanDepth: assessment.replanDepth
    };
  }

  public async getPlanHistory(planId: string): Promise<TaskPlan[]> {
    const history: TaskPlan[] = [];
    const visited = new Set<string>();
    let currentId: string | undefined = planId;

    while (currentId) {
      if (visited.has(currentId)) {
        // Cycle detected: prevent infinite loop
        break;
      }
      visited.add(currentId);

      const plan = await this.getPlan(currentId);
      if (!plan) {
        break;
      }

      history.push(plan);

      if (history.length > this.maxReplanDepth + 10) {
        break;
      }

      currentId = plan.parentPlanId;
    }

    return history;
  }
}
