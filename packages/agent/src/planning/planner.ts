import type { TaskRiskLevel } from "../policy/types.js";
import type {
  CreatePlanParams,
  ExecutionIntent,
  PlanRisk,
  PlanStep,
  ReplanParams,
  SuggestedCheckpoint,
  TaskPlan,
  TaskPlanner
} from "./types.js";
import { createTaskPlan } from "./taskPlan.js";

function isReadOnlyIntent(userMessage: string): boolean {
  const lower = userMessage.toLowerCase();
  const writeKeywords = [
    "create",
    "write",
    "modify",
    "edit",
    "update",
    "delete",
    "remove",
    "refactor",
    "fix",
    "implement",
    "build",
    "install",
    "run",
    "execute"
  ];
  return !writeKeywords.some((w) => lower.includes(w));
}

export class DefaultTaskPlanner implements TaskPlanner {
  public createPlan(params: CreatePlanParams): TaskPlan {
    const isReadOnly = isReadOnlyIntent(params.userMessage);
    const authoritativeRisk: TaskRiskLevel = params.authoritativeRisk || "normal";

    const steps: PlanStep[] = [];
    const risks: PlanRisk[] = [];
    const checkpoints: SuggestedCheckpoint[] = [];

    // 1. Initial Discovery / Inspection Step
    const step1Id = "step-1";
    steps.push({
      stepId: step1Id,
      order: 1,
      title: "Inspect workspace and relevant context",
      objective: `Locate and inspect relevant files and codebase context for: ${params.userMessage.slice(0, 100)}`,
      type: "inspect",
      dependencies: [],
      expectedFiles: params.affectedFiles || [],
      expectedTools: ["read_file", "search_files", "list_directory"],
      riskLevel: "low",
      verificationRequired: false,
      status: "pending",
      intent: {
        type: "inspect_file",
        reason: "Inspect existing code and workspace state before mutation",
        requiresApproval: false,
        estimatedRisk: "low"
      }
    });

    if (isReadOnly) {
      // Read-only task
      steps.push({
        stepId: "step-2",
        order: 2,
        title: "Analyze and synthesize findings",
        objective: `Analyze context and synthesize answer for: ${params.userMessage.slice(0, 100)}`,
        type: "analyze",
        dependencies: [step1Id],
        riskLevel: "low",
        verificationRequired: false,
        status: "pending",
        intent: {
          type: "search_code",
          reason: "Synthesize findings to satisfy user query",
          requiresApproval: false,
          estimatedRisk: "low"
        }
      });
    } else {
      // Modifying task
      const step2Id = "step-2";
      const mutationRisk: TaskRiskLevel =
        authoritativeRisk === "critical"
          ? "critical"
          : authoritativeRisk === "elevated"
            ? "elevated"
            : "normal";

      const modifyIntent: ExecutionIntent = {
        type: "modify_file",
        target: params.affectedFiles && params.affectedFiles[0] ? params.affectedFiles[0] : undefined,
        reason: "Implement changes requested by the user",
        requiresApproval: true,
        estimatedRisk: mutationRisk
      };

      steps.push({
        stepId: step2Id,
        order: 2,
        title: "Implement requested modifications",
        objective: `Apply code edits to fulfill: ${params.userMessage.slice(0, 100)}`,
        type: "modify",
        dependencies: [step1Id],
        expectedFiles: params.affectedFiles || [],
        expectedTools: ["write_file", "edit_file"],
        riskLevel: mutationRisk,
        verificationRequired: true,
        status: "pending",
        intent: modifyIntent
      });

      // Verification Step
      const step3Id = "step-3";
      steps.push({
        stepId: step3Id,
        order: 3,
        title: "Verify changes and run checks",
        objective: "Execute project tests and verification to ensure no regressions",
        type: "verify",
        dependencies: [step2Id],
        expectedTools: ["execute_command"],
        riskLevel: "normal",
        verificationRequired: true,
        status: "pending",
        intent: {
          type: "verify_changes",
          reason: "Confirm modifications pass linting, typechecking, and tests",
          requiresApproval: false,
          estimatedRisk: "normal"
        }
      });

      // If elevated or critical risk, add risk and checkpoint recommendations
      if (mutationRisk === "elevated" || mutationRisk === "critical") {
        risks.push({
          level: mutationRisk,
          category: "workspace_mutation",
          description: `Task involves ${mutationRisk} mutation operations`,
          mitigation: "Create recovery checkpoint before modifying critical files"
        });
        checkpoints.push({
          name: `checkpoint-pre-${params.runId}`,
          reason: "Recovery snapshot before applying modifications",
          timing: "before_mutation"
        });
      }
    }

    return createTaskPlan({
      runId: params.runId,
      userRequestSummary: params.userMessage,
      objective: `Fulfill user request: ${params.userMessage.slice(0, 120)}`,
      assumptions: [
        "Workspace files are accessible within current working directory",
        "Required tools and dependencies are available"
      ],
      steps,
      risks,
      checkpoints,
      verificationStrategy: ["typecheck", "lint", "test"],
      status: "ready"
    });
  }

  public replan(oldPlan: TaskPlan, params: ReplanParams): TaskPlan {
    const freshPlan = this.createPlan(params);
    return {
      ...freshPlan,
      parentPlanId: oldPlan.planId,
      rootPlanId: oldPlan.rootPlanId || oldPlan.planId,
      replanDepth: (oldPlan.replanDepth ?? 0) + 1,
      replanReason: params.reason,
      replanCount: (oldPlan.replanCount ?? 0) + 1,
      invalidationReason: params.reason
    };
  }
}
