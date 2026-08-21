import type { GitRepository } from "../git/types.js";
import type { ExecutionPolicy } from "../policy/types.js";
import type { SkillRegistry } from "../skills/types.js";
import type { SkillActivationPolicy } from "../skills/activation.js";
import type { ProjectContext } from "../project/types.js";
import { getProjectIdentifier } from "./projectIdentifier.js";
import {
  captureWorkspaceFingerprint,
  compareWorkspaceFingerprints
} from "./workspaceFingerprint.js";
import type {
  DurableRunRecord,
  ResumeManager,
  ResumePreparation,
  RunHistoryStore
} from "./types.js";

export interface DefaultResumeManagerOptions {
  historyStore: RunHistoryStore;
  gitRepository?: GitRepository;
  executionPolicy: ExecutionPolicy;
  skillRegistry?: SkillRegistry;
  activationPolicy?: SkillActivationPolicy;
  projectContext?: ProjectContext;
}

export class DefaultResumeManager implements ResumeManager {
  private readonly historyStore: RunHistoryStore;
  private readonly gitRepository?: GitRepository;
  private readonly executionPolicy: ExecutionPolicy;
  private readonly skillRegistry?: SkillRegistry;
  private readonly activationPolicy?: SkillActivationPolicy;
  private readonly projectContext?: ProjectContext;

  constructor(options: DefaultResumeManagerOptions) {
    this.historyStore = options.historyStore;
    this.gitRepository = options.gitRepository;
    this.executionPolicy = options.executionPolicy;
    this.skillRegistry = options.skillRegistry;
    this.activationPolicy = options.activationPolicy;
    this.projectContext = options.projectContext;
  }

  public async prepareResume(
    runId: string,
    currentCwd: string
  ): Promise<ResumePreparation> {
    const originalRun = await this.historyStore.getRun(runId);
    if (!originalRun) {
      throw new Error(`Run not found in history: ${runId}`);
    }

    const newRunId = `run-resume-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const resumeDepth = (originalRun.resumeDepth ?? 0) + 1;

    // 1. Resumability check
    if (originalRun.finalStatus === "completed") {
      return {
        canResume: false,
        originalRun,
        suggestedParentRunId: originalRun.runId,
        newRunId,
        resumeDepth,
        workspaceChanged: false,
        workspaceDiffReasons: [],
        reassessedRisk: this.executionPolicy.assess({
          userMessage: originalRun.userRequestSummary,
          cwd: currentCwd,
          affectedFiles: [],
          operations: []
        }),
        reassessedSkills: [],
        requiresUserConfirmation: false,
        explanation: `Run ${runId} was completed successfully and cannot be resumed.`
      };
    }

    // 2. Project identity validation
    const currentProjectId = await getProjectIdentifier(
      currentCwd,
      this.gitRepository
    );

    if (originalRun.projectId && originalRun.projectId !== currentProjectId) {
      return {
        canResume: false,
        originalRun,
        suggestedParentRunId: originalRun.runId,
        newRunId,
        resumeDepth,
        workspaceChanged: true,
        workspaceDiffReasons: [
          `Project mismatch: Run belongs to project "${originalRun.projectId}", but current directory is "${currentProjectId}"`
        ],
        reassessedRisk: this.executionPolicy.assess({
          userMessage: originalRun.userRequestSummary,
          cwd: currentCwd,
          affectedFiles: [],
          operations: []
        }),
        reassessedSkills: [],
        requiresUserConfirmation: true,
        explanation: `Cannot resume run ${runId}: Project mismatch (belongs to "${originalRun.projectId}", current is "${currentProjectId}").`
      };
    }

    // 3. Workspace change detection
    const trackedFiles = [
      ...originalRun.files.modified,
      ...originalRun.files.created,
      ...originalRun.files.deleted
    ];

    const currentFingerprint = await captureWorkspaceFingerprint(
      currentCwd,
      trackedFiles,
      this.gitRepository
    );

    const diff = compareWorkspaceFingerprints(
      originalRun.workspaceFingerprint,
      currentFingerprint
    );

    // 4. Re-evaluate task risk
    const reassessedRisk = this.executionPolicy.assess({
      userMessage: originalRun.userRequestSummary,
      cwd: currentCwd,
      affectedFiles: trackedFiles,
      operations: originalRun.tools.map((t) => t.toolName)
    });

    // 5. Re-evaluate skills
    let reassessedSkills: string[] = [];
    if (this.skillRegistry && this.activationPolicy) {
      const activation = this.activationPolicy.activate(
        originalRun.userRequestSummary,
        this.skillRegistry,
        this.projectContext
      );
      reassessedSkills = activation.skills.map((s: { name: string }) => s.name);
    } else {
      reassessedSkills = [...originalRun.activeSkills];
    }

    const requiresConfirmation =
      !diff.matches ||
      reassessedRisk.requiresExplicitApproval ||
      reassessedRisk.requiresCheckpoint;

    const explanationParts: string[] = [
      `Resuming task from run ${originalRun.runId} (${originalRun.finalStatus}).`
    ];

    if (!diff.matches) {
      explanationParts.push(
        `Workspace changes detected:\n${diff.reasons.map((r) => `  - ${r}`).join("\n")}`
      );
    }

    if (originalRun.failureReason) {
      explanationParts.push(`Previous failure reason: ${originalRun.failureReason}`);
    }

    return {
      canResume: true,
      originalRun,
      suggestedParentRunId: originalRun.runId,
      newRunId,
      resumeDepth,
      workspaceChanged: !diff.matches,
      workspaceDiffReasons: diff.reasons,
      reassessedRisk,
      reassessedSkills,
      requiresUserConfirmation: requiresConfirmation,
      explanation: explanationParts.join("\n")
    };
  }

  public buildResumeContext(
    originalRun: DurableRunRecord,
    prep: ResumePreparation
  ): string {
    const lines: string[] = [
      `[RESUMED TASK EXECUTION]`,
      `Original User Request: ${originalRun.userRequestSummary}`,
      `Previous Execution Status: ${originalRun.finalStatus}`,
      `Resume Lineage: Run ${originalRun.runId} -> Resumed Run ${prep.newRunId} (Depth: ${prep.resumeDepth})`
    ];

    if (originalRun.failureReason) {
      lines.push(`Previous Failure Reason: ${originalRun.failureReason}`);
    } else if (originalRun.cancellationReason) {
      lines.push(`Previous Cancellation Reason: ${originalRun.cancellationReason}`);
    }

    const modified = originalRun.files?.modified || [];
    const created = originalRun.files?.created || [];
    const deleted = originalRun.files?.deleted || [];
    if (modified.length > 0 || created.length > 0 || deleted.length > 0) {
      lines.push(
        `Previous Modified Files: ${[...modified, ...created, ...deleted].join(", ")}`
      );
    }

    if (prep.workspaceChanged && prep.workspaceDiffReasons.length > 0) {
      lines.push(
        `Workspace Drift Detected Since Previous Run:\n${prep.workspaceDiffReasons.map((r) => `  - ${r}`).join("\n")}`
      );
    }

    lines.push(
      `\nINSTRUCTIONS FOR RESUMED EXECUTION:`,
      `1. The above information is historical context only. Previous tool calls, command outputs, and approval tokens are NOT automatically restored.`,
      `2. You MUST inspect the current workspace using tools (e.g. read_file, search_files, list_directory) to verify current state before mutating files.`,
      `3. Complete the original user request: "${originalRun.userRequestSummary}".`,
      `4. Verify your work with fresh verification checks.`
    );

    return lines.join("\n");
  }
}
