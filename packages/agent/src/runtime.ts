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
}

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
}

export class AgentRuntime implements Agent {
  private readonly modelProvider: ModelProvider;
  private readonly systemPrompt: string;
  private readonly registry: ToolRegistry;
  private readonly executor: ToolExecutor;
  private readonly permissionManager: PermissionManager;
  private readonly approvalResolver?: ApprovalResolver;
  private readonly maxVerificationAttempts: number;
  private readonly projectContext?: ProjectContext;
  private readonly skillRegistry?: SkillRegistry;
  private readonly activationPolicy?: SkillActivationPolicy;
  private readonly tokenOptimizer: TokenOptimizer;
  private state: AgentState;
  private activeController: AbortController | null = null;

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
    this.projectContext = options.projectContext;
    this.skillRegistry = options.skillRegistry;
    this.activationPolicy = options.activationPolicy;
    this.tokenOptimizer = options.tokenOptimizer || new DefaultTokenOptimizer();

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

  public getState(): AgentState {
    return {
      ...this.state,
      messages: [...this.state.messages],
      tokenUsage: this.state.tokenUsage ? { ...this.state.tokenUsage } : undefined
    };
  }

  async *run(input: AgentInput): AsyncIterable<AgentEvent> {
    if (input.sessionId && this.state.messages.length === 0) {
      this.state.sessionId = input.sessionId;
    }

    this.state.status = "running";
    this.activeController = new AbortController();

    this.state.messages.push({
      role: "user",
      content: input.message
    });

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
        projectContext: this.projectContext,
        activeSkills: activated.skills,
        tokenOptimizer: this.tokenOptimizer
      });
    } else if (this.projectContext) {
      activeSystemPrompt = composeSystemPrompt({
        baseSystemPrompt: this.systemPrompt,
        projectContext: this.projectContext,
        activeSkills: []
      });
    }

    try {
      while (true) {
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
          let result: ToolResult;

          if (!tool) {
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
              const approvalRequest: ApprovalRequest = {
                id: `approval-${call.id}`,
                toolName: tool.name,
                category: tool.permissionCategory || "write",
                arguments: call.arguments,
                reason: decision.reason
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

          // Check if this was a command execution that failed
          if (call.name === "execute_command") {
            const cmdOutput = result.output as CommandResult | undefined;
            const isFailure =
              !result.success ||
              (cmdOutput && cmdOutput.exitCode !== 0) ||
              (cmdOutput && cmdOutput.timedOut);

            if (isFailure) {
              const attempts = (this.state.verificationAttempts || 0) + 1;
              this.state.verificationAttempts = attempts;

              if (attempts >= this.maxVerificationAttempts) {
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
      yield { type: "error", error };
    } finally {
      this.activeController = null;
    }
  }

  async cancel(): Promise<void> {
    if (this.activeController) {
      this.state.status = "cancelled";
      this.activeController.abort();
    }
  }
}
