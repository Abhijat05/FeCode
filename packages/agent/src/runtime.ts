import {
  DefaultPermissionManager,
  DefaultToolExecutor,
  DefaultToolRegistry
} from "@fecode/models";
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalResolver,
  ModelMessage,
  ModelProvider,
  ModelRequest,
  PermissionManager,
  TokenUsage,
  ToolCall,
  ToolExecutor,
  ToolRegistry,
  ToolResult
} from "@fecode/models";
import type { Agent, AgentEvent, AgentInput } from "./index.js";
import { DEFAULT_SYSTEM_PROMPT } from "./systemPrompt.js";
import type { CommandResult } from "./commands/types.js";
import type { ProjectContext } from "./project/types.js";
import type { SkillRegistry } from "./skills/types.js";
import { SkillActivationPolicy } from "./skills/activation.js";
import { composeSystemPrompt } from "./skills/composer.js";
import type { TokenOptimizer } from "./optimization/types.js";
import { DefaultTokenOptimizer } from "./optimization/defaultOptimizer.js";
import type { AgentPolicyRegistry } from "./policies/types.js";
import { DefaultAgentPolicyRegistry } from "./policies/registry.js";
import type { TaskPlan } from "./tasks/types.js";
import { failTaskStep } from "./tasks/taskPlan.js";
import { SafeEditValidator } from "./editing/validator.js";
import {
  calculateDiffStats,
  createChangeReview,
  type ChangeReviewFile
} from "./editing/changeReview.js";

export type AgentStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentState {
  sessionId: string;
  status: AgentStatus;
  messages: ModelMessage[];
  tokenUsage?: TokenUsage;
  verificationAttempts?: number;
  activePlan?: TaskPlan;
}

import type { RepositoryExplorer, ExplorationResult } from "./exploration/types.js";
import type { CodeContextSelector, CodeContextResult } from "./context/types.js";
import type { AgentExecutionStrategy } from "./strategy/types.js";
import { DefaultAgentExecutionStrategy } from "./strategy/executionStrategy.js";
import { TaskCompletionTracker } from "./completion/tracker.js";
import type { TaskCompletionSummary } from "./completion/types.js";
import type { PersistedSessionData } from "./session/types.js";
import type { GitRepository } from "./git/types.js";
import { DefaultGitRepository } from "./git/gitRepository.js";
import { computeChangeAttribution } from "./git/attribution.js";

export interface AgentRuntimeOptions {
  systemPrompt?: string;
  sessionId?: string;
  registry?: ToolRegistry;
  executor?: ToolExecutor;
  permissionManager?: PermissionManager;
  approvalResolver?: ApprovalResolver;
  maxVerificationAttempts?: number;
  projectContext?: ProjectContext;
  skillRegistry?: SkillRegistry;
  activationPolicy?: SkillActivationPolicy;
  tokenOptimizer?: TokenOptimizer;
  policyRegistry?: AgentPolicyRegistry;
  repositoryExplorer?: RepositoryExplorer;
  codeContextSelector?: CodeContextSelector;
  executionStrategy?: AgentExecutionStrategy;
  gitRepository?: GitRepository;
  maxIdenticalToolCalls?: number;
  maxTurns?: number;
}

export class AgentRuntime implements Agent {
  private readonly modelProvider: ModelProvider;
  private readonly systemPrompt: string;
  private readonly registry: ToolRegistry;
  private readonly executor: ToolExecutor;
  private readonly permissionManager: PermissionManager;
  private readonly approvalResolver?: ApprovalResolver;
  private readonly maxVerificationAttempts: number;
  private readonly maxIdenticalToolCalls: number;
  private readonly maxTurns: number;
  private readonly projectContext?: ProjectContext;
  private readonly skillRegistry?: SkillRegistry;
  private readonly activationPolicy?: SkillActivationPolicy;
  private readonly tokenOptimizer: TokenOptimizer;
  private readonly policyRegistry: AgentPolicyRegistry;
  private readonly repositoryExplorer?: RepositoryExplorer;
  private readonly codeContextSelector?: CodeContextSelector;
  private readonly executionStrategy: AgentExecutionStrategy;
  private readonly gitRepository?: GitRepository;
  private readonly completionTracker: TaskCompletionTracker = new TaskCompletionTracker();
  private readonly safeEditValidator: SafeEditValidator = new SafeEditValidator();
  private state: AgentState;
  private activeController: AbortController | null = null;
  private lastToolCallKey: string | null = null;
  private consecutiveToolCallCount: number = 0;

  constructor(modelProvider: ModelProvider, options: AgentRuntimeOptions = {}) {
    this.modelProvider = modelProvider;
    this.systemPrompt = options.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this.registry = options.registry || new DefaultToolRegistry();
    this.executor =
      options.executor || new DefaultToolExecutor(this.registry);
    this.permissionManager =
      options.permissionManager || new DefaultPermissionManager();
    this.approvalResolver = options.approvalResolver;
    this.maxVerificationAttempts = options.maxVerificationAttempts ?? 3;
    this.maxIdenticalToolCalls = options.maxIdenticalToolCalls ?? 3;
    this.maxTurns = options.maxTurns ?? 50;
    this.projectContext = options.projectContext;
    this.skillRegistry = options.skillRegistry;
    this.activationPolicy = options.activationPolicy;
    this.tokenOptimizer = options.tokenOptimizer || new DefaultTokenOptimizer();
    this.policyRegistry = options.policyRegistry || new DefaultAgentPolicyRegistry();
    this.repositoryExplorer = options.repositoryExplorer;
    this.codeContextSelector = options.codeContextSelector;
    this.executionStrategy = options.executionStrategy || new DefaultAgentExecutionStrategy();
    this.gitRepository = options.gitRepository || new DefaultGitRepository();

    this.state = {
      sessionId:
        options.sessionId ||
        `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      status: "idle",
      messages: [],
      verificationAttempts: 0
    };
  }

  public getRegistry(): ToolRegistry {
    return this.registry;
  }

  public getCompletionSummary(): TaskCompletionSummary {
    return this.completionTracker.getSummary();
  }

  public getState(): AgentState {
    return {
      ...this.state,
      messages: [...this.state.messages],
      tokenUsage: this.state.tokenUsage ? { ...this.state.tokenUsage } : undefined,
      activePlan: this.state.activePlan
        ? {
            ...this.state.activePlan,
            steps: this.state.activePlan.steps.map((s) => ({ ...s }))
          }
        : undefined
    };
  }

  public getPlan(): TaskPlan | undefined {
    return this.state.activePlan;
  }

  public setPlan(plan: TaskPlan): void {
    this.state.activePlan = plan;
  }

  public clear(): void {
    this.state.messages = [];
    this.state.activePlan = undefined;
    this.state.verificationAttempts = 0;
    this.lastToolCallKey = null;
    this.consecutiveToolCallCount = 0;
    this.completionTracker.reset();
    this.state.status = "idle";
    if (this.repositoryExplorer) {
      this.repositoryExplorer.invalidate();
    }
    if (this.codeContextSelector) {
      this.codeContextSelector.invalidate();
    }
  }

  public restoreSession(data: PersistedSessionData): void {
    this.state.sessionId = data.sessionId;
    this.state.messages = [...(data.messages || [])];
    this.state.status =
      data.status === "completed"
        ? "completed"
        : data.status === "cancelled"
          ? "cancelled"
          : data.status === "blocked"
            ? "failed"
            : "idle";
    this.state.verificationAttempts = 0;
    this.lastToolCallKey = null;
    this.consecutiveToolCallCount = 0;
    this.completionTracker.reset();
  }

  async *run(input: AgentInput): AsyncIterable<AgentEvent> {
    if (input.sessionId && this.state.messages.length === 0) {
      this.state.sessionId = input.sessionId;
    }

    this.state.status = "running";
    this.activeController = new AbortController();
    this.completionTracker.reset();
    this.completionTracker.setRequest(input.message);
    this.lastToolCallKey = null;
    this.consecutiveToolCallCount = 0;
    this.state.verificationAttempts = 0;

    if (this.gitRepository) {
      try {
        const isRepo = await this.gitRepository.isRepository(input.cwd);
        if (isRepo) {
          const baseline = await this.gitRepository.getSnapshot(input.cwd);
          this.completionTracker.setBaselineSnapshot(baseline);
        }
      } catch {
        // ignore git errors
      }
    }

    this.state.messages.push({
      role: "user",
      content: input.message
    });

    const decision = this.executionStrategy.decide(input.message, {
      projectProfile: this.projectContext?.profile,
      activePlan: this.state.activePlan,
      verificationAttempts: this.state.verificationAttempts
    });

    let explorationResult: ExplorationResult | undefined;
    if (decision.shouldExplore && this.repositoryExplorer) {
      try {
        explorationResult = await this.repositoryExplorer.explore(input.message, {
          cwd: input.cwd,
          projectProfile: this.projectContext?.profile,
          signal: this.activeController.signal
        });
      } catch {
        // ignore exploration errors
      }
    }

    let codeContext: CodeContextResult | undefined;
    if (decision.shouldSelectContext && this.codeContextSelector && explorationResult) {
      try {
        codeContext = await this.codeContextSelector.selectContext(
          explorationResult,
          input.message,
          {
            cwd: input.cwd,
            signal: this.activeController.signal
          }
        );
      } catch {
        // ignore selection error
      }
    }

    const policies = this.policyRegistry.list();
    let activeSystemPrompt = this.systemPrompt;
    if (this.skillRegistry && this.activationPolicy) {
      const activated = this.activationPolicy.activate(
        input.message,
        this.skillRegistry,
        this.projectContext
      );
      if (activated.skills.length > 0) {
        yield { type: "skills_activated", skills: activated.skills.map((s) => s.name) };
      }
      activeSystemPrompt = composeSystemPrompt({
        baseSystemPrompt: this.systemPrompt,
        policies,
        projectContext: this.projectContext,
        activeSkills: activated.skills,
        tokenOptimizer: this.tokenOptimizer,
        explorationResult,
        codeContext,
        strategyGuidance: decision.guidance
      });
    } else {
      activeSystemPrompt = composeSystemPrompt({
        baseSystemPrompt: this.systemPrompt,
        policies,
        projectContext: this.projectContext,
        activeSkills: [],
        explorationResult,
        codeContext,
        strategyGuidance: decision.guidance
      });
    }

    let turnCount = 0;
    try {
      while (turnCount < this.maxTurns) {
        turnCount++;
        if (this.activeController.signal.aborted) {
          throw new Error("Request aborted");
        }

        const registeredTools = this.registry.list();
        const toolDefinitions = registeredTools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }));

        const request: ModelRequest = {
          system: activeSystemPrompt,
          messages: [...this.state.messages],
          tools: toolDefinitions.length ? toolDefinitions : undefined
        };

        let accumulatedText = "";
        const toolCallsForTurn: ToolCall[] = [];
        let turnError: Error | null = null;

        const stream = this.modelProvider.generate(
          request,
          this.activeController.signal
        );

        for await (const event of stream) {
          if (event.type === "text_delta") {
            accumulatedText += event.content;
            yield { type: "text", content: event.content };
          } else if (event.type === "tool_call") {
            toolCallsForTurn.push(event.call);
            yield { type: "tool_call", call: event.call };
          } else if (event.type === "completed") {
            if (event.usage) {
              const currentUsage = this.state.tokenUsage || {};
              this.state.tokenUsage = {
                inputTokens:
                  (currentUsage.inputTokens || 0) +
                  (event.usage.inputTokens || 0),
                outputTokens:
                  (currentUsage.outputTokens || 0) +
                  (event.usage.outputTokens || 0),
                totalTokens:
                  (currentUsage.totalTokens || 0) +
                  (event.usage.totalTokens || 0)
              };
            }
          } else if (event.type === "error") {
            turnError = event.error;
            yield { type: "error", error: event.error };
            break;
          }
        }

        if (turnError) {
          const isCancelled =
            this.activeController.signal.aborted ||
            turnError.message.toLowerCase().includes("abort") ||
            turnError.message.toLowerCase().includes("cancel");
          this.state.status = isCancelled ? "cancelled" : "failed";
          break;
        }

        this.state.messages.push({
          role: "assistant",
          content: accumulatedText || undefined,
          toolCalls: toolCallsForTurn.length ? toolCallsForTurn : undefined
        });

        if (toolCallsForTurn.length === 0) {
          this.state.status = "completed";

          if (this.gitRepository) {
            try {
              const isRepo = await this.gitRepository.isRepository(input.cwd);
              if (isRepo) {
                const postTask = await this.gitRepository.getSnapshot(input.cwd);
                this.completionTracker.setPostTaskSnapshot(postTask);

                const baseline = this.completionTracker.getBaselineSnapshot() || null;
                const currentSum = this.completionTracker.getSummary();
                const fecodePaths = currentSum.changeSet
                  ? currentSum.changeSet.files.map((f) => f.path)
                  : currentSum.completedFiles;

                const attribution = computeChangeAttribution(
                  baseline,
                  postTask,
                  fecodePaths
                );
                this.completionTracker.setGitAttribution(attribution);
              }
            } catch {
              // ignore git errors
            }
          }

          const summary = this.completionTracker.evaluateCompletion({
            activePlan: this.state.activePlan
          });
          if (
            this.state.activePlan !== undefined ||
            summary.completedFiles.length > 0 ||
            summary.verifiedCommands.length > 0 ||
            summary.completedRequirements.length > 0 ||
            summary.status === "blocked"
          ) {
            yield { type: "task_summary", summary };
          }
          yield { type: "done" };
          break;
        }

        for (const call of toolCallsForTurn) {
          if (this.activeController.signal.aborted) {
            throw new Error("Request aborted");
          }

          const toolContext = {
            cwd: input.cwd,
            signal: this.activeController.signal
          };

          const tool = this.registry.get(call.name);
          let result: ToolResult = {
            success: false,
            error: {
              message: "Tool execution failed",
              code: "UNEXPECTED_ERROR"
            }
          };

          const callKey = `${call.name}::${JSON.stringify(call.arguments || {})}`;
          if (this.lastToolCallKey === callKey) {
            this.consecutiveToolCallCount++;
          } else {
            this.lastToolCallKey = callKey;
            this.consecutiveToolCallCount = 1;
          }

          if (this.consecutiveToolCallCount > this.maxIdenticalToolCalls) {
            result = {
              success: false,
              error: {
                message: `Repeated identical tool call loop detected (${call.name} called ${this.consecutiveToolCallCount} times with identical arguments). Modify parameters, broaden search, or proceed with an alternative approach.`,
                code: "REPEATED_CALL_LOOP"
              }
            };
          } else if (!tool) {
            result = {
              success: false,
              error: {
                message: `Tool not found: ${call.name}`,
                code: "NOT_FOUND"
              }
            };
          } else {
            const decision = await this.permissionManager.check(
              tool,
              toolContext
            );

            if (decision.type === "denied") {
              result = {
                success: false,
                error: {
                  message: decision.reason,
                  code: "PERMISSION_DENIED"
                }
              };
            } else if (decision.type === "requires_approval") {
              let skipApproval = false;
              let changeReview: unknown;

              if (call.name === "edit_file") {
                const args = (call.arguments || {}) as {
                  path?: string;
                  oldText?: string;
                  newText?: string;
                  expectedHash?: string;
                };

                if (
                  args.oldText !== undefined &&
                  args.newText !== undefined &&
                  args.oldText === args.newText
                ) {
                  // No-op edit: identical oldText and newText
                  skipApproval = true;
                  result = {
                    success: true,
                    output: {
                      path: args.path || "",
                      replacements: 0,
                      bytesWritten: 0,
                      changed: false,
                      reason: "NO_CHANGE"
                    }
                  };
                } else {
                  const validated = await this.safeEditValidator.validateEdit(
                    args.path || "",
                    args.oldText || "",
                    args.newText || "",
                    toolContext.cwd,
                    {
                      expectedHash: args.expectedHash,
                      signal: toolContext.signal
                    }
                  );

                  if (!validated.valid) {
                    skipApproval = true;
                    result = {
                      success: false,
                      error: validated.error
                    };
                  } else {
                    const stats = calculateDiffStats(validated.diff);
                    if (stats.additions === 0 && stats.deletions === 0) {
                      // No-op (+0 -0)
                      skipApproval = true;
                      result = {
                        success: true,
                        output: {
                          path: validated.displayPath,
                          replacements: 0,
                          bytesWritten: 0,
                          changed: false,
                          reason: "NO_CHANGE"
                        }
                      };
                    } else {
                      const fileReview: ChangeReviewFile = {
                        path: validated.displayPath,
                        operation: "modified",
                        additions: stats.additions,
                        deletions: stats.deletions,
                        diff: validated.diff
                      };
                      changeReview = createChangeReview([fileReview]);
                    }
                  }
                }
              } else if (call.name === "write_file") {
                const args = (call.arguments || {}) as {
                  path?: string;
                  content?: string;
                };

                const validated = await this.safeEditValidator.validateWrite(
                  args.path || "",
                  args.content || "",
                  toolContext.cwd,
                  { signal: toolContext.signal }
                );

                if (!validated.valid) {
                  skipApproval = true;
                  result = {
                    success: false,
                    error: validated.error
                  };
                } else if (
                  validated.originalContent === validated.proposedContent &&
                  validated.originalContent !== ""
                ) {
                  // No-op write: identical content
                  skipApproval = true;
                  result = {
                    success: true,
                    output: {
                      path: validated.displayPath,
                      created: false,
                      overwritten: true,
                      bytesWritten: Buffer.byteLength(
                        validated.proposedContent,
                        "utf-8"
                      ),
                      changed: false,
                      reason: "NO_CHANGE"
                    }
                  };
                } else {
                  const stats = calculateDiffStats(validated.diff);
                  const isNew = validated.originalContent === "";
                  const fileReview: ChangeReviewFile = {
                    path: validated.displayPath,
                    operation: isNew ? "added" : "modified",
                    additions: stats.additions,
                    deletions: stats.deletions,
                    diff: validated.diff
                  };
                  changeReview = createChangeReview([fileReview]);
                }
              }

              if (!skipApproval) {
                const approvalRequest: ApprovalRequest = {
                  id: `approval-${call.id}`,
                  toolName: tool.name,
                  category: tool.permissionCategory || "write",
                  arguments: call.arguments,
                  reason: decision.reason,
                  changeReview
                };

                yield { type: "approval_required", request: approvalRequest };

                let approvalDecision: ApprovalDecision = {
                  approved: false,
                  reason: "Approval required but no resolver configured."
                };

                if (this.approvalResolver) {
                  approvalDecision = await this.approvalResolver.resolve(
                    approvalRequest
                  );
                }

                if (approvalDecision.approved) {
                  result = await this.executor.execute(call, toolContext);
                } else {
                  result = {
                    success: false,
                    error: {
                      message:
                        approvalDecision.reason ||
                        "Tool execution was denied by the user.",
                      code: "PERMISSION_DENIED"
                    }
                  };
                }
              }
            } else {
              result = await this.executor.execute(call, toolContext);
            }
          }

          yield { type: "tool_result", result, callId: call.id };

          this.state.messages.push({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content: JSON.stringify(result)
          });

          // Invalidate repository exploration & code context caches if file was modified
          if (
            result.success &&
            (call.name === "write_file" || call.name === "edit_file")
          ) {
            this.lastToolCallKey = null;
            this.consecutiveToolCallCount = 0;
            const targetPath = (call.arguments as { path?: string })?.path;
            const output = result.output as {
              path?: string;
              diff?: string;
              changed?: boolean;
              created?: boolean;
            };

            if (targetPath && output?.changed !== false) {
              const diffStr = output?.diff || "";
              const stats = calculateDiffStats(diffStr);
              const op =
                call.name === "write_file" && output?.created
                  ? "added"
                  : "modified";
              this.completionTracker.recordFileChange({
                path: targetPath,
                operation: op,
                additions: stats.additions,
                deletions: stats.deletions
              });
            } else if (targetPath) {
              this.completionTracker.recordFileModified(targetPath);
            }
            if (this.repositoryExplorer) {
              this.repositoryExplorer.invalidate(targetPath);
            }
            if (this.codeContextSelector) {
              this.codeContextSelector.invalidate(targetPath);
            }
          }

          if (!result.success && result.error?.code === "PERMISSION_DENIED") {
            this.completionTracker.recordBlocked(
              result.error.message || `Permission denied for ${call.name}`
            );
          }

          // Check if this was a command execution
          if (call.name === "execute_command") {
            const cmdOutput = result.output as CommandResult | undefined;
            const isFailure =
              !result.success ||
              (cmdOutput && cmdOutput.exitCode !== 0) ||
              Boolean(cmdOutput && cmdOutput.timedOut);

            const cmd = (call.arguments as { command?: string })?.command || "";
            const exitCode = cmdOutput ? cmdOutput.exitCode : (result.success ? 0 : 1);
            const timedOut = Boolean(cmdOutput?.timedOut);
            const succeeded = result.success && exitCode === 0 && !timedOut;

            this.completionTracker.recordCommandExecution({
              command: cmd,
              exitCode,
              timedOut,
              succeeded
            });

            if (isFailure) {
              const attempts: number = (this.state.verificationAttempts || 0) + 1;
              this.state.verificationAttempts = attempts;

              if (attempts >= this.maxVerificationAttempts) {
                this.completionTracker.recordBlocked(
                  `Verification failed after ${this.maxVerificationAttempts} attempts`
                );
                this.state.messages.push({
                  role: "user",
                  content: `[SYSTEM NOTICE] Maximum verification attempts (${this.maxVerificationAttempts}) reached. Do not attempt further verification commands. Report the current status, failure details, and remaining unresolved issues to the user.`
                });
              }
            }
          }
        }
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      const isCancelled =
        this.activeController?.signal.aborted ||
        error.message.toLowerCase().includes("abort") ||
        error.message.toLowerCase().includes("cancel");

      this.state.status = isCancelled ? "cancelled" : "failed";
      if (isCancelled) {
        this.completionTracker.recordCancelled();
      } else {
        this.completionTracker.recordBlocked(error.message);
      }
      yield { type: "error", error };
    } finally {
      this.activeController = null;
    }
  }

  async cancel(): Promise<void> {
    this.completionTracker.recordCancelled();
    if (this.state.activePlan && this.state.activePlan.status === "in_progress") {
      const currentIdx = this.state.activePlan.currentStep ?? 0;
      this.state.activePlan = failTaskStep(
        this.state.activePlan,
        currentIdx,
        "Cancelled"
      );
    }
    if (this.activeController) {
      this.state.status = "cancelled";
      this.activeController.abort();
    }
  }
}
