import type { GitRepository } from "../git/types.js";
import type { ExecutionPolicy } from "../policy/types.js";
import type { SkillRegistry } from "../skills/types.js";
import type { SkillActivationPolicy } from "../skills/activation.js";
import type { ProjectContext } from "../project/types.js";
import {
  captureWorkspaceFingerprint,
  compareWorkspaceFingerprints
} from "./workspaceFingerprint.js";
import type {
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

    // 1. Resumability check
    if (originalRun.finalStatus === "completed") {
      return {
        canResume: false,
        originalRun,
        suggestedParentRunId: originalRun.runId,
        newRunId,
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

    // 2. Workspace change detection
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

    // 3. Re-evaluate task risk
    const reassessedRisk = this.executionPolicy.assess({
      userMessage: originalRun.userRequestSummary,
      cwd: currentCwd,
      affectedFiles: trackedFiles,
      operations: originalRun.tools.map((t) => t.toolName)
    });

    // 4. Re-evaluate skills
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
      workspaceChanged: !diff.matches,
      workspaceDiffReasons: diff.reasons,
      reassessedRisk,
      reassessedSkills,
      requiresUserConfirmation: requiresConfirmation,
      explanation: explanationParts.join("\n")
    };
  }
}
