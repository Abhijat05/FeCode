import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import {
  DefaultSessionStore,
  SessionHistoryFormatter,
  DefaultGitRepository,
  GitStatusFormatter,
  DefaultCheckpointManager,
  CheckpointFormatter,
  DefaultRecoveryManager,
  RecoveryFormatter,
  DefaultTaskRiskPolicy,
  formatRunDiagnostics,
  RunHistoryFormatter,
  PlanFormatter,
  transitionPlanStatus,
  DefaultProductRuntime,
  type ProductRuntime,
  type UIState,
  type Agent,
  type AgentRuntime,
  type ProjectContext,
  type SessionStore,
  type PersistedSessionData,
  type SessionStatus,
  type TaskCompletionSummary,
  type CheckpointManager,
  type RecoveryManager,
  type ExecutionPolicy,
  type RunHistoryStore
} from "@fecode/agent";
import type { ApprovalRequest, ModelMessage } from "@fecode/models";
import { InteractiveApprovalResolver } from "./approvalResolver.js";
import { filterCommands, type CommandDef } from "./commands.js";
import {
  AppShell,
  Header,
  StatusBar,
  TaskInput,
  ThinkingIndicator,
  TurnView,
  PlanView,
  ApprovalPrompt,
  BlockedView,
  RecoveryView,
  ReplanView,
  ResumeView,
  DiagnosticsView,
  RunHistoryView,
  HelpView
} from "./ui/index.js";

export interface Turn {
  id: string;
  prompt: string;
  response: string;
  status: "thinking" | "streaming" | "done" | "error" | "cancelled";
  error?: string;
}

export interface AppProps {
  agent?: Agent;
  productRuntime?: ProductRuntime;
  cwd?: string;
  providerName?: string;
  modelName?: string;
  approvalResolver?: InteractiveApprovalResolver;
  onExit?: () => void;
  configError?: string;
  projectContext?: ProjectContext;
  sessionStore?: SessionStore;
  initialSessionData?: PersistedSessionData;
  gitRepository?: import("@fecode/agent").GitRepository;
  checkpointManager?: CheckpointManager;
  recoveryManager?: RecoveryManager;
  executionPolicy?: ExecutionPolicy;
  historyStore?: RunHistoryStore;
}

export const App: React.FC<AppProps> = ({
  agent,
  productRuntime: runtimeProp,
  cwd = process.cwd(),
  providerName,
  modelName,
  approvalResolver,
  onExit,
  configError,
  projectContext: _projectContext,
  sessionStore,
  initialSessionData,
  gitRepository: gitRepoProp,
  checkpointManager: checkpointManagerProp,
  recoveryManager: recoveryManagerProp,
  executionPolicy: executionPolicyProp
}) => {
  const gitRepo = gitRepoProp || new DefaultGitRepository();
  const cpManager =
    checkpointManagerProp ||
    (agent && "getCheckpointManager" in agent && typeof (agent as unknown as { getCheckpointManager: () => CheckpointManager }).getCheckpointManager === "function"
      ? (agent as unknown as { getCheckpointManager: () => CheckpointManager }).getCheckpointManager()
      : new DefaultCheckpointManager(undefined, gitRepo));
  const recManager =
    recoveryManagerProp ||
    (agent && "getRecoveryManager" in agent && typeof (agent as unknown as { getRecoveryManager: () => RecoveryManager }).getRecoveryManager === "function"
      ? (agent as unknown as { getRecoveryManager: () => RecoveryManager }).getRecoveryManager()
      : new DefaultRecoveryManager(undefined, gitRepo));
  const _execPolicy =
    executionPolicyProp ||
    (agent && "getExecutionPolicy" in agent && typeof (agent as unknown as { getExecutionPolicy: () => ExecutionPolicy }).getExecutionPolicy === "function"
      ? (agent as unknown as { getExecutionPolicy: () => ExecutionPolicy }).getExecutionPolicy()
      : new DefaultTaskRiskPolicy());
  void _execPolicy;
  void _projectContext;

  // Instantiate or use ProductRuntime
  const [runtime] = useState<ProductRuntime>(() => {
    if (runtimeProp) return runtimeProp;
    if (agent && "run" in agent && "assessTaskRisk" in agent) {
      return new DefaultProductRuntime({
        agentRuntime: agent as AgentRuntime,
        gitRepository: gitRepo,
        approvalResolver,
        initialCwd: cwd,
        initialSessionId: initialSessionData?.sessionId
      });
    }
    return undefined as unknown as ProductRuntime;
  });

  const { exit } = useApp();
  const [query, setQuery] = useState("");
  const [activeView, setActiveView] = useState<
    "main" | "plan" | "runs" | "diagnostics" | "help" | "git"
  >("main");
  const [store] = useState<SessionStore>(
    () => sessionStore || new DefaultSessionStore()
  );
  const [sessionId] = useState<string>(
    () =>
      initialSessionData?.sessionId ||
      `session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
  );
  const [taskCount, setTaskCount] = useState<number>(
    () => initialSessionData?.taskCount || 0
  );
  const [completedSummaries, setCompletedSummaries] = useState<
    TaskCompletionSummary[]
  >(() => initialSessionData?.completedTaskSummaries || []);
  const [lastTaskStatus, setLastTaskStatus] = useState<SessionStatus>(
    () => initialSessionData?.status || "idle"
  );
  const [activeRequest, setActiveRequest] = useState<string | undefined>(
    undefined
  );
  const startedAtRef = useRef<Date>(
    initialSessionData?.startedAt
      ? new Date(initialSessionData.startedAt)
      : new Date()
  );

  const [turns, setTurns] = useState<Turn[]>(() => {
    if (initialSessionData) {
      return [
        {
          id: `init-${Date.now()}`,
          prompt: `--resume ${initialSessionData.sessionId}`,
          response: SessionHistoryFormatter.formatResumeSummary(
            initialSessionData
          ),
          status: "done"
        }
      ];
    }
    return [];
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const prevIsGeneratingRef = useRef(false);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    setSelectedSuggestion(0);
  };
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(
    null
  );
  const [approvalInput, setApprovalInput] = useState("");
  const [blockedInput, setBlockedInput] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [replanInput, setReplanInput] = useState("");
  const [resumeInput, setResumeInput] = useState("");

  const [pendingResume, setPendingResume] = useState<{
    runId: string;
    prep: import("@fecode/agent").ResumePreparation;
  } | null>(null);
  const [pendingReplan, setPendingReplan] = useState<{
    planId: string;
    assessment: import("@fecode/agent").ReplanAssessment;
  } | null>(null);
  const [pendingPlanBlocked, setPendingPlanBlocked] = useState<{
    plan: import("@fecode/agent").TaskPlan;
    assessment: import("@fecode/agent").PlanAdaptationAssessment;
    reconciliationResult?: import("@fecode/agent").FinalReconciliationResult;
  } | null>(null);
  const [pendingRecovery, setPendingRecovery] = useState<{
    plan: import("@fecode/agent").TaskPlan;
    assessment: import("@fecode/agent").ExecutionRecoveryAssessment;
  } | null>(null);
  const [pendingRecoveryContinuation, setPendingRecoveryContinuation] = useState<{
    plan: import("@fecode/agent").TaskPlan;
    preparation: import("@fecode/agent").RecoveryContinuationPreparation;
  } | null>(null);

  const hasModal =
    Boolean(pendingApproval) ||
    Boolean(pendingPlanBlocked) ||
    Boolean(pendingRecovery) ||
    Boolean(pendingRecoveryContinuation) ||
    Boolean(pendingReplan) ||
    Boolean(pendingResume);

  const commandSuggestions: CommandDef[] =
    !isGenerating && !hasModal && query.startsWith("/")
      ? filterCommands(query)
      : [];

  // Subscribe to ProductRuntime event stream
  const [uiState, setUiState] = useState<UIState | undefined>(() =>
    runtime?.getUIState?.()
  );

  useEffect(() => {
    if (!runtime || !runtime.subscribe) return;
    const unsubscribe = runtime.subscribe((state: UIState) => {
      setUiState(state);
    });
    return () => {
      unsubscribe();
    };
  }, [runtime]);

  // Hook into ApprovalResolver if present
  useEffect(() => {
    if (approvalResolver) {
      approvalResolver.onRequest = (request: ApprovalRequest) => {
        setPendingApproval((prev) => {
          if (prev && prev.id === request.id) {
            return {
              ...request,
              changeReview: request.changeReview || prev.changeReview,
              reason: request.reason || prev.reason
            };
          }
          return request;
        });
      };
    }
  }, [approvalResolver]);

  // Auto-submit queued prompt when generation completes
  useEffect(() => {
    if (prevIsGeneratingRef.current && !isGenerating && pendingQuery) {
      const queued = pendingQuery;
      setPendingQuery(null);
      void handleSubmit(queued);
    }
    prevIsGeneratingRef.current = isGenerating;
  }, [isGenerating, pendingQuery]);

  const persistState = useCallback(
    async (
      status: SessionStatus,
      newSummary?: TaskCompletionSummary,
      explicitTaskCount?: number
    ) => {
      try {
        const summaries = newSummary
          ? [...completedSummaries, newSummary]
          : completedSummaries;
        if (newSummary) {
          setCompletedSummaries(summaries);
        }
        const state = (
          agent as { getState?: () => { messages?: ModelMessage[] } }
        )?.getState?.();
        const messages = state?.messages || [];
        await store.save({
          version: 1,
          sessionId,
          workingDirectory: cwd,
          provider: providerName || "unknown",
          model: modelName || "unknown",
          startedAt: startedAtRef.current.toISOString(),
          updatedAt: new Date().toISOString(),
          taskCount:
            explicitTaskCount !== undefined ? explicitTaskCount : taskCount,
          status,
          completedTaskSummaries: summaries,
          messages
        });
      } catch {
        // Silently catch persistence error
      }
    },
    [
      store,
      sessionId,
      cwd,
      providerName,
      modelName,
      taskCount,
      completedSummaries,
      agent
    ]
  );

  const handleExit = useCallback(() => {
    persistState(lastTaskStatus).catch(() => {});
    if (onExit) {
      onExit();
    } else {
      exit();
    }
  }, [onExit, exit, persistState, lastTaskStatus]);

  // Keyboard navigation & shortcuts
  useInput(
    (input, key) => {
      // Tab: select top autocomplete suggestion
      if (key.tab && commandSuggestions.length > 0) {
        const selected = commandSuggestions[selectedSuggestion];
        if (selected) {
          setQuery(selected.command + " ");
          setSelectedSuggestion(0);
        }
        return;
      }

      // ArrowDown / ArrowUp: cycle suggestions
      if (key.downArrow && commandSuggestions.length > 0) {
        setSelectedSuggestion((prev) => (prev + 1) % commandSuggestions.length);
        return;
      }
      if (key.upArrow && commandSuggestions.length > 0) {
        setSelectedSuggestion((prev) =>
          prev === 0 ? commandSuggestions.length - 1 : prev - 1
        );
        return;
      }

      // Ctrl+C cancellation
      if (key.ctrl && input === "c") {
        if (pendingQuery) {
          setPendingQuery(null);
          return;
        }

        if (pendingApproval) {
          if (approvalResolver) {
            approvalResolver.cancelPending("Approval request cancelled via Ctrl+C");
          }
          setPendingApproval(null);
          setApprovalInput("");
          return;
        }

        if (isGenerating && agent) {
          agent.cancel().catch(() => {});
          setIsGenerating(false);
          setPendingQuery(null);
          setLastTaskStatus("cancelled");
          setActiveRequest(undefined);

          const cancelledSummary: TaskCompletionSummary = {
            taskIndex: taskCount,
            request: activeRequest || "Task",
            status: "cancelled",
            completedFiles: [],
            verifiedCommands: [],
            completedRequirements: [],
            remainingRequirements: []
          };
          setCompletedSummaries((prev) => [...prev, cancelledSummary]);
          persistState("cancelled", cancelledSummary).catch(() => {});

          setTurns((prev) => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            const lastIndex = updated.length - 1;
            updated[lastIndex] = {
              ...updated[lastIndex],
              status: "cancelled",
              error: "Generation cancelled."
            };
            return updated;
          });
        } else {
          handleExit();
        }
        return;
      }

      // Escape returns to main view
      if (key.escape) {
        setActiveView("main");
        return;
      }
    },
    { isActive: true }
  );

  const handleApprovalSubmit = (value: string) => {
    const trimmed = value.trim();
    setApprovalInput("");
    setPendingApproval(null);
    if (approvalResolver) {
      approvalResolver.submitDecision(trimmed);
    }
  };

  const handleSubmit = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    // Queue the prompt if agent is currently running and no modal is active
    const modalActive =
      Boolean(pendingApproval) ||
      Boolean(pendingPlanBlocked) ||
      Boolean(pendingRecovery) ||
      Boolean(pendingRecoveryContinuation) ||
      Boolean(pendingReplan) ||
      Boolean(pendingResume);

    if (isGenerating && !modalActive) {
      setPendingQuery(trimmed);
      setQuery("");
      return;
    }
    if (isGenerating) return;

    // Handle modal submissions first
    if (pendingRecoveryContinuation) {
      setQuery("");
      setRecoveryInput("");
      const prc = pendingRecoveryContinuation;
      setPendingRecoveryContinuation(null);

      const choice = trimmed.toLowerCase();
      if (choice === "y" || choice === "yes") {
        const contTurnId = `turn-${Date.now()}`;
        setTurns((prev) => [
          ...prev,
          {
            id: contTurnId,
            prompt: trimmed,
            response: "Starting continuation...\n",
            status: "streaming"
          }
        ]);

        if (agent && "continueRecoveredPlan" in agent) {
          try {
            for await (const ev of (
              agent as {
                continueRecoveredPlan: (
                  preparation: import("@fecode/agent").RecoveryContinuationPreparation,
                  request: import("@fecode/agent").RecoveryContinuationRequest
                ) => AsyncIterable<import("@fecode/agent").AgentEvent>;
              }
            ).continueRecoveredPlan(prc.preparation, {
              runId: prc.plan.runId,
              planId: prc.plan.planId,
              decision: "continue",
              approved: true,
              cwd
            })) {
              if (ev.type === "plan_step_started") {
                setTurns((prev) =>
                  prev.map((t) =>
                    t.id === contTurnId
                      ? {
                          ...t,
                          response:
                            t.response +
                            `[${ev.stepIndex + 1}/${prc.plan.steps.length}] ${ev.title || "Step"} ...\n`
                        }
                      : t
                  )
                );
              } else if (ev.type === "plan_step_completed") {
                setTurns((prev) =>
                  prev.map((t) =>
                    t.id === contTurnId
                      ? {
                          ...t,
                          response: t.response + "✓ COMPLETED\n\n"
                        }
                      : t
                  )
                );
              } else if (
                ev.type === "recovery_continuation_completed" ||
                ev.type === "plan_execution_completed"
              ) {
                setTurns((prev) =>
                  prev.map((t) =>
                    t.id === contTurnId
                      ? {
                          ...t,
                          status: "done",
                          response: t.response.includes("✓ Plan completed")
                            ? t.response
                            : t.response + "✓ Plan completed\n"
                        }
                      : t
                  )
                );
              } else if (ev.type === "recovery_continuation_blocked") {
                setTurns((prev) =>
                  prev.map((t) =>
                    t.id === contTurnId
                      ? {
                          ...t,
                          status: "done",
                          response:
                            t.response +
                            `⚠ Continuation blocked: ${ev.blockingReasons.join("; ")}\n`
                        }
                      : t
                  )
                );
              } else if (ev.type === "recovery_continuation_cancelled") {
                setTurns((prev) =>
                  prev.map((t) =>
                    t.id === contTurnId
                      ? {
                          ...t,
                          status: "done",
                          response: t.response + "Continuation cancelled.\n"
                        }
                      : t
                  )
                );
              }
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setTurns((prev) =>
              prev.map((t) =>
                t.id === contTurnId
                  ? {
                      ...t,
                      status: "error",
                      response: t.response + `✗ Continuation error: ${msg}\n`
                    }
                  : t
              )
            );
          }
        }
      } else {
        setTurns((prev) => [
          ...prev,
          {
            id: `cmd-${Date.now()}`,
            prompt: trimmed,
            response: "Continuation cancelled.\n",
            status: "done"
          }
        ]);
      }
      return;
    }

    if (pendingRecovery) {
      setQuery("");
      setRecoveryInput("");
      const pr = pendingRecovery;
      setPendingRecovery(null);

      const choice = trimmed.toLowerCase();
      if (choice === "y" || choice === "yes") {
        const recTurnId = `turn-${Date.now()}`;
        setTurns((prev) => [
          ...prev,
          {
            id: recTurnId,
            prompt: trimmed,
            response: "Recovery started\n",
            status: "streaming"
          }
        ]);

        try {
          if (agent && "executeExecutionRecovery" in agent) {
            for await (const ev of (
              agent as {
                executeExecutionRecovery: (
                  assessment: import("@fecode/agent").ExecutionRecoveryAssessment,
                  opts: { cwd: string; approved: boolean }
                ) => AsyncIterable<import("@fecode/agent").AgentEvent>;
              }
            ).executeExecutionRecovery(pr.assessment, { cwd, approved: true })) {
              if (ev.type === "recovery_step_started") {
                setTurns((prev) =>
                  prev.map((t) =>
                    t.id === recTurnId
                      ? {
                          ...t,
                          response:
                            t.response +
                            `[${ev.stepIndex}/${ev.totalSteps}] ${ev.title} ... `
                        }
                      : t
                  )
                );
              } else if (ev.type === "recovery_step_completed") {
                setTurns((prev) =>
                  prev.map((t) =>
                    t.id === recTurnId
                      ? {
                          ...t,
                          response: t.response + `${ev.success ? "✓" : "✗"}\n`
                        }
                      : t
                  )
                );
              } else if (ev.type === "recovery_verification_started") {
                setTurns((prev) =>
                  prev.map((t) =>
                    t.id === recTurnId
                      ? {
                          ...t,
                          response: t.response + `\nVerification\n`
                        }
                      : t
                  )
                );
              } else if (ev.type === "recovery_verification_completed") {
                setTurns((prev) =>
                  prev.map((t) =>
                    t.id === recTurnId
                      ? {
                          ...t,
                          response:
                            t.response +
                            `${ev.success ? "✓" : "✗"} ${ev.command}\n\n`
                        }
                      : t
                  )
                );
              } else if (ev.type === "recovery_reconciliation_started") {
                setTurns((prev) =>
                  prev.map((t) =>
                    t.id === recTurnId
                      ? {
                          ...t,
                          response: t.response + `Workspace reconciliation\n`
                        }
                      : t
                  )
                );
              } else if (ev.type === "recovery_reconciliation_completed") {
                setTurns((prev) =>
                  prev.map((t) =>
                    t.id === recTurnId
                      ? {
                          ...t,
                          response:
                            t.response +
                            `${ev.result.consistent ? "✓ Workspace consistent" : "⚠ Inconsistent"}\n\n`
                        }
                      : t
                  )
                );
              } else if (ev.type === "recovery_outcome_determined") {
                const outcomeText = PlanFormatter.formatRecoveryOutcome(ev.result);
                if (
                  ev.outcome === "recovered" ||
                  ev.outcome === "recovered_with_changes"
                ) {
                  let prep: import("@fecode/agent").RecoveryContinuationPreparation | undefined;
                  if (agent && "prepareRecoveryContinuation" in agent) {
                    try {
                      prep = await (
                        agent as {
                          prepareRecoveryContinuation: (opts: {
                            cwd: string;
                            recoveryResult: import("@fecode/agent").ExecutionRecoveryResult;
                            recoveryOutcome: import("@fecode/agent").RecoveryOutcomeStatus;
                          }) => Promise<import("@fecode/agent").RecoveryContinuationPreparation>;
                        }
                      ).prepareRecoveryContinuation({
                        cwd,
                        recoveryResult: ev.result,
                        recoveryOutcome: ev.outcome
                      });
                    } catch {
                      // ignore
                    }
                  }

                  if (prep && prep.canContinue) {
                    setPendingRecoveryContinuation({
                      plan: pr.plan,
                      preparation: prep
                    });
                    const contText = PlanFormatter.formatRecoveryContinuationPrompt(
                      prep
                    );
                    setTurns((prev) =>
                      prev.map((t) =>
                        t.id === recTurnId
                          ? {
                              ...t,
                              status: "done",
                              response: `${outcomeText}\n\n${contText}\n`
                            }
                          : t
                      )
                    );
                  } else {
                    const incompleteSteps = pr.plan.steps.filter(
                      (s) => s.status !== "completed" && s.status !== "skipped"
                    );
                    if (incompleteSteps.length > 0 && !prep) {
                      const fallbackPrep: import("@fecode/agent").RecoveryContinuationPreparation = {
                        eligible: true,
                        canContinue: true,
                        planId: pr.plan.planId,
                        runId: pr.plan.runId,
                        recoveryOutcome: ev.outcome,
                        remainingSteps: incompleteSteps,
                        completedSteps: pr.plan.steps.filter((s) => s.status === "completed"),
                        skippedSteps: pr.plan.steps.filter((s) => s.status === "skipped"),
                        reconciliationConsistent: true,
                        requiresExplicitApproval: true
                      };
                      setPendingRecoveryContinuation({
                        plan: pr.plan,
                        preparation: fallbackPrep
                      });
                      const contText = PlanFormatter.formatRecoveryContinuationPrompt(
                        fallbackPrep
                      );
                      setTurns((prev) =>
                        prev.map((t) =>
                          t.id === recTurnId
                            ? {
                                ...t,
                                status: "done",
                                response: `${outcomeText}\n\n${contText}\n`
                              }
                            : t
                        )
                      );
                    } else {
                      setTurns((prev) =>
                        prev.map((t) =>
                          t.id === recTurnId
                            ? {
                                ...t,
                                status: "done",
                                response: `${outcomeText}\n\n✓ Plan completed\n`
                              }
                            : t
                        )
                      );
                    }
                  }
                } else if (ev.outcome === "still_blocked") {
                  const defaultAdaptation: import("@fecode/agent").PlanAdaptationAssessment = {
                    planId: pr.plan.planId,
                    assessedAt: Date.now(),
                    canContinue: false,
                    canRetry: false,
                    canAdapt: true,
                    feedback: [],
                    affectedSteps: [...ev.result.affectedSteps],
                    currentRiskLevel: "normal",
                    requiresUserConfirmation: true,
                    recommendedAction: "replan"
                  };
                  setPendingPlanBlocked({
                    plan: pr.plan,
                    assessment: defaultAdaptation,
                    reconciliationResult: ev.result.reconciliationResult
                  });
                  setTurns((prev) =>
                    prev.map((t) =>
                      t.id === recTurnId
                        ? {
                            ...t,
                            status: "done",
                            response: `${outcomeText}\n`
                          }
                        : t
                    )
                  );
                } else {
                  setTurns((prev) =>
                    prev.map((t) =>
                      t.id === recTurnId
                        ? {
                            ...t,
                            status: "done",
                            response: `${outcomeText}\n`
                          }
                        : t
                    )
                  );
                }
              } else if (ev.type === "recovery_completed") {
                setTurns((prev) =>
                  prev.map((t) =>
                    t.id === recTurnId
                      ? {
                          ...t,
                          status: "done",
                          response: t.response.includes("Recovery completed")
                            ? t.response
                            : t.response + "✓ Recovery completed\n"
                        }
                      : t
                  )
                );
              }
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setTurns((prev) =>
            prev.map((t) =>
              t.id === recTurnId
                ? {
                    ...t,
                    status: "error",
                    response: t.response + `✗ Recovery error: ${msg}\n`
                  }
                : t
            )
          );
        }
      } else {
        setTurns((prev) => [
          ...prev,
          {
            id: `cmd-${Date.now()}`,
            prompt: trimmed,
            response: "✓ Recovery cancelled\n",
            status: "done"
          }
        ]);
      }
      return;
    }

    if (pendingPlanBlocked) {
      setQuery("");
      const pb = pendingPlanBlocked;
      setPendingPlanBlocked(null);

      const choice = trimmed.toLowerCase();
      const isRecon = !!pb.reconciliationResult;

      if (isRecon && (choice === "r" || choice === "recover" || choice === "recovery")) {
        try {
          if (agent && "assessExecutionRecovery" in agent) {
            const assessment = await (
              agent as {
                assessExecutionRecovery: (
                  planId?: string,
                  opts?: {
                    cwd: string;
                    reconciliationResult?: import("@fecode/agent").FinalReconciliationResult;
                  }
                ) => Promise<import("@fecode/agent").ExecutionRecoveryAssessment>;
              }
            ).assessExecutionRecovery(pb.plan.planId, {
              cwd,
              reconciliationResult: pb.reconciliationResult
            });

            setPendingRecovery({ assessment, plan: pb.plan });
            const promptText = PlanFormatter.formatRecoveryAssessment(assessment);
            setTurns((prev) => [
              ...prev,
              {
                id: `cmd-${Date.now()}`,
                prompt: trimmed,
                response: `${promptText}\n`,
                status: "done"
              }
            ]);
            return;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: `✗ Recovery assessment error: ${msg}\n`,
              status: "done"
            }
          ]);
          return;
        }
      }

      if (
        (!isRecon && (choice === "r" || choice === "replan")) ||
        (isRecon && (choice === "p" || choice === "replan"))
      ) {
        try {
          if (agent && "resolveExecutionDecision" in agent) {
            await (
              agent as {
                resolveExecutionDecision: (
                  id: string,
                  d: string,
                  opts?: { cwd: string }
                ) => Promise<import("@fecode/agent").ExecutionDecisionResult>;
              }
            ).resolveExecutionDecision(pb.plan.planId, "replan", { cwd });
          }

          if (agent && "prepareReplan" in agent) {
            const assessment = await (
              agent as {
                prepareReplan: (
                  id?: string,
                  opts?: { cwd: string }
                ) => Promise<import("@fecode/agent").ReplanAssessment>;
              }
            ).prepareReplan(pb.plan.planId, { cwd });

            if (!assessment.eligible) {
              setTurns((prev) => [
                ...prev,
                {
                  id: `cmd-${Date.now()}`,
                  prompt: trimmed,
                  response: `✗ Replanning not eligible: ${assessment.reason}\n`,
                  status: "done"
                }
              ]);
            } else {
              setPendingReplan({ planId: pb.plan.planId, assessment });
              const promptText = PlanFormatter.formatReplanPrompt(assessment);
              const replanNotice = PlanFormatter.formatReplanNotice();
              setTurns((prev) => [
                ...prev,
                {
                  id: `cmd-${Date.now()}`,
                  prompt: trimmed,
                  response: `${replanNotice}\n\n${promptText}\n`,
                  status: "done"
                }
              ]);
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: `✗ Replanning error: ${msg}\n`,
              status: "done"
            }
          ]);
        }
      } else if (
        choice === "c" ||
        choice === "continue" ||
        choice === "re-check" ||
        choice === "recheck"
      ) {
        let resumeNotice = `↻ Resuming plan ${pb.plan.planId}...\n`;
        try {
          if (agent && "resolveExecutionDecision" in agent) {
            const decisionResult = await (
              agent as {
                resolveExecutionDecision: (
                  id: string,
                  d: string,
                  opts?: { cwd: string }
                ) => Promise<import("@fecode/agent").ExecutionDecisionResult>;
              }
            ).resolveExecutionDecision(pb.plan.planId, "continue", { cwd });

            const incompleteStep =
              pb.plan.steps.find((s) => s.stepId === decisionResult.resumedStepId) ||
              pb.plan.steps[0];
            if (incompleteStep) {
              resumeNotice = `${PlanFormatter.formatResumeNotice(
                pb.plan.planId,
                incompleteStep.order,
                pb.plan.steps.length,
                incompleteStep.title
              )}\n`;
            }
          }
          if (agent && "getTaskPlan" in agent) {
            transitionPlanStatus(pb.plan, "executing");
          }
        } catch {
          // ignore
        }
        setTurns((prev) => [
          ...prev,
          {
            id: `cmd-${Date.now()}`,
            prompt: trimmed,
            response: resumeNotice,
            status: "done"
          }
        ]);
      } else {
        // default / 'x' / 'cancel'
        try {
          if (agent && "resolveExecutionDecision" in agent) {
            await (
              agent as {
                resolveExecutionDecision: (
                  id: string,
                  d: string,
                  opts?: { cwd: string }
                ) => Promise<import("@fecode/agent").ExecutionDecisionResult>;
              }
            ).resolveExecutionDecision(pb.plan.planId, "cancel", { cwd });
          }
          if (agent && "cancel" in agent) {
            await agent.cancel();
          }
        } catch {
          // ignore
        }
        setTurns((prev) => [
          ...prev,
          {
            id: `cmd-${Date.now()}`,
            prompt: trimmed,
            response: `${PlanFormatter.formatCancelNotice()}\n`,
            status: "done"
          }
        ]);
      }
      return;
    }

    if (pendingReplan) {
      setQuery("");
      const pr = pendingReplan;
      setPendingReplan(null);

      if (trimmed.toLowerCase() === "y" || trimmed.toLowerCase() === "yes") {
        try {
          if (agent && "executeReplan" in agent) {
            const replanResult = await (
              agent as {
                executeReplan: (
                  req: import("@fecode/agent").ReplanRequest
                ) => Promise<import("@fecode/agent").ReplanResult>;
              }
            ).executeReplan({
              runId: `run-replan-${Date.now()}`,
              previousPlanId: pr.planId,
              reason: pr.assessment.reason,
              explanation: pr.assessment.explanation,
              failedStepId: pr.assessment.affectedStepId,
              cwd,
              userRequest: pr.assessment.previousPlan?.userRequestSummary || "",
              requestedBy: "user"
            });

            if (replanResult.status === "created" && replanResult.newPlan) {
              const formattedPlan = PlanFormatter.formatPlanDetail(
                replanResult.newPlan
              );
              setTurns((prev) => [
                ...prev,
                {
                  id: `cmd-${Date.now()}`,
                  prompt: trimmed,
                  response: `✓ Created replacement plan: ${replanResult.newPlanId}\n\n${formattedPlan}\n\nType /plan to inspect or approve when ready.\n`,
                  status: "done"
                }
              ]);
            } else {
              setTurns((prev) => [
                ...prev,
                {
                  id: `cmd-${Date.now()}`,
                  prompt: trimmed,
                  response: `✗ Replanning failed: ${replanResult.reason}\n`,
                  status: "done"
                }
              ]);
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: `✗ Error creating replan: ${msg}\n`,
              status: "done"
            }
          ]);
        }
      } else {
        setTurns((prev) => [
          ...prev,
          {
            id: `cmd-${Date.now()}`,
            prompt: trimmed,
            response: "Replanning cancelled.\n",
            status: "done"
          }
        ]);
      }
      return;
    }

    if (pendingResume) {
      setQuery("");
      const pr = pendingResume;
      setPendingResume(null);

      if (trimmed.toLowerCase() === "y" || trimmed.toLowerCase() === "yes") {
        setTurns((prev) => [
          ...prev,
          {
            id: `cmd-${Date.now()}`,
            prompt: trimmed,
            response: `✓ Resuming run ${pr.runId} as ${pr.prep.newRunId}...\n`,
            status: "done"
          }
        ]);

        if (agent && "resumeRun" in agent) {
          setIsGenerating(true);
          const nextTaskCount = taskCount + 1;
          setTaskCount(nextTaskCount);
          setActiveRequest(pr.prep.originalRun.userRequestSummary);
          setLastTaskStatus("in_progress");

          const turnId = `turn-${Date.now()}`;
          const newTurn: Turn = {
            id: turnId,
            prompt: `Resume task: ${pr.prep.originalRun.userRequestSummary}`,
            response: "",
            status: "streaming"
          };
          setTurns((prev) => [...prev, newTurn]);

          try {
            for await (const event of (
              agent as {
                resumeRun: (
                  id: string,
                  opts?: { cwd: string }
                ) => AsyncIterable<import("@fecode/agent").AgentEvent>;
              }
            ).resumeRun(pr.runId, { cwd })) {
              if (event.type === "text") {
                setTurns((prev) =>
                  prev.map((t) =>
                    t.id === turnId
                      ? { ...t, response: t.response + event.content }
                      : t
                  )
                );
              } else if (event.type === "done") {
                setTurns((prev) =>
                  prev.map((t) =>
                    t.id === turnId ? { ...t, status: "done" } : t
                  )
                );
              }
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setTurns((prev) =>
              prev.map((t) =>
                t.id === turnId
                  ? { ...t, status: "error", error: `✗ ${msg}` }
                  : t
              )
            );
          } finally {
            setIsGenerating(false);
          }
        }
      } else {
        setTurns((prev) => [
          ...prev,
          {
            id: `cmd-${Date.now()}`,
            prompt: trimmed,
            response: "✗ Resume cancelled by user.\n",
            status: "done"
          }
        ]);
      }
      return;
    }

    // Slash command processing
    if (trimmed.startsWith("/")) {
      setQuery("");
      const parts = trimmed.split(" ");
      const cmd = parts[0].toLowerCase();
      const arg = parts.slice(1).join(" ").trim();

      if (cmd === "/help") {
        setActiveView("help");
        setTurns((prev) => [
          ...prev,
          {
            id: `cmd-${Date.now()}`,
            prompt: trimmed,
            response:
              "Available commands:\n  /help       - Show this help message\n  /status     - Show provider, model, and session status\n  /history    - Show task history in this session\n  /tasks      - List completed tasks\n  /task <num> - View details of a specific task\n  /sessions   - List past sessions\n  /clear      - Clear conversation history\n  /exit       - Exit FeCode\n",
            status: "done"
          }
        ]);
        return;
      }

      if (cmd === "/status") {
        setTurns((prev) => [
          ...prev,
          {
            id: `cmd-${Date.now()}`,
            prompt: trimmed,
            response: `FeCode\n\nProvider:          ${providerName || "unknown"}\nModel:             ${modelName || "unknown"}\nWorking directory: ${cwd}\nSession:           ${sessionId}\n`,
            status: "done"
          }
        ]);
        return;
      }

      if (cmd === "/clear") {
        setTurns([]);
        setTurns([
          {
            id: `cmd-${Date.now()}`,
            prompt: trimmed,
            response:
              "✓ Conversation cleared\n\nSession history remains available through:\n  /history  - View completed tasks\n  /tasks    - List task summaries\n  /status   - Session details\n",
            status: "done"
          }
        ]);
        return;
      }

      if (cmd === "/exit" || cmd === "/quit") {
        handleExit();
        return;
      }

      if (cmd === "/history") {
        const historyText = SessionHistoryFormatter.formatHistory(
          completedSummaries
        );
        setTurns((prev) => [
          ...prev,
          {
            id: `cmd-${Date.now()}`,
            prompt: trimmed,
            response: historyText,
            status: "done"
          }
        ]);
        return;
      }

      if (cmd === "/tasks") {
        const tasksText = SessionHistoryFormatter.formatTaskList(
          completedSummaries
        );
        setTurns((prev) => [
          ...prev,
          {
            id: `cmd-${Date.now()}`,
            prompt: trimmed,
            response: tasksText,
            status: "done"
          }
        ]);
        return;
      }

      if (cmd === "/task") {
        if (!arg) {
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response:
                "Current Task\n\nNo active task.\n\nUse /tasks to see completed tasks in this session.\n",
              status: "done"
            }
          ]);
          return;
        }

        const taskNum = parseInt(arg, 10);
        const summary = completedSummaries.find((s) => s.taskIndex === taskNum);
        if (summary) {
          const detailText = SessionHistoryFormatter.formatTaskDetail(summary);
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: detailText,
              status: "done"
            }
          ]);
        } else {
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: `✗ Task not found: ${arg}\n\nUse /tasks to see available tasks (1-${completedSummaries.length}).\n`,
              status: "done"
            }
          ]);
        }
        return;
      }

      if (cmd === "/git") {
        try {
          const statusResult = await gitRepo.getStatus(cwd);
          const formatted = GitStatusFormatter.formatGitStatus(statusResult);
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: formatted,
              status: "done"
            }
          ]);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: `✗ Git error: ${msg}\n`,
              status: "done"
            }
          ]);
        }
        return;
      }

      if (cmd === "/checkpoints") {
        try {
          const list = await cpManager.list();
          const formatted = CheckpointFormatter.formatCheckpointsList(list);
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: formatted,
              status: "done"
            }
          ]);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: `✗ Checkpoints error: ${msg}\n`,
              status: "done"
            }
          ]);
        }
        return;
      }

      if (cmd === "/checkpoint") {
        try {
          const cpRes = await cpManager.create({
            cwd,
            reason: arg || "Manual checkpoint"
          });
          const formatted = cpRes.checkpoint
            ? CheckpointFormatter.formatCheckpointCreated(cpRes.checkpoint)
            : "✓ Checkpoint created\n";
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: formatted,
              status: "done"
            }
          ]);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: `✗ Checkpoint error: ${msg}\n`,
              status: "done"
            }
          ]);
        }
        return;
      }

      if (cmd === "/recover") {
        if (!arg || arg === "status") {
          try {
            const statusRec = recManager.getLastRecord();
            const formatted = RecoveryFormatter.formatRecoveryStatus(statusRec);
            setTurns((prev) => [
              ...prev,
              {
                id: `cmd-${Date.now()}`,
                prompt: trimmed,
                response: formatted,
                status: "done"
              }
            ]);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setTurns((prev) => [
              ...prev,
              {
                id: `cmd-${Date.now()}`,
                prompt: trimmed,
                response: `✗ Recovery error: ${msg}\n`,
                status: "done"
              }
            ]);
          }
          return;
        }

        if (arg.startsWith("preview")) {
          const cpId = arg.replace("preview", "").trim();
          if (!cpId) {
            setTurns((prev) => [
              ...prev,
              {
                id: `cmd-${Date.now()}`,
                prompt: trimmed,
                response: "✗ Please specify a checkpoint ID for preview.\n",
                status: "done"
              }
            ]);
            return;
          }
          try {
            const preview = await recManager.preview(cpId, cwd);
            const formatted = RecoveryFormatter.formatRecoveryPreview(preview);
            setTurns((prev) => [
              ...prev,
              {
                id: `cmd-${Date.now()}`,
                prompt: trimmed,
                response: formatted,
                status: "done"
              }
            ]);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setTurns((prev) => [
              ...prev,
              {
                id: `cmd-${Date.now()}`,
                prompt: trimmed,
                response: `✗ Recovery preview error: ${msg}\n`,
                status: "done"
              }
            ]);
          }
          return;
        }
      }

      if (cmd === "/debug" || cmd === "/diagnostics") {
        setActiveView("diagnostics");
        let summary: import("@fecode/agent").RunSummary | undefined;
        if (agent && "getRunSummary" in agent) {
          summary = (
            agent as {
              getRunSummary: (
                id?: string
              ) => import("@fecode/agent").RunSummary | undefined;
            }
          ).getRunSummary(arg || undefined);
        } else if (runtime && runtime.getDiagnosticsSummary) {
          summary = runtime.getDiagnosticsSummary(arg || undefined);
        }

        if (summary) {
          const formatted = formatRunDiagnostics(summary);
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: formatted,
              status: "done"
            }
          ]);
        } else {
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: "No run diagnostics available.\n",
              status: "done"
            }
          ]);
        }
        return;
      }

      if (cmd === "/runs") {
        setActiveView("runs");
        let runs: import("@fecode/agent").DurableRunRecord[] = [];
        if (agent && "listHistoricalRuns" in agent) {
          runs = await (
            agent as {
              listHistoricalRuns: () => Promise<
                import("@fecode/agent").DurableRunRecord[]
              >;
            }
          ).listHistoricalRuns();
        } else if (runtime && runtime.getHistoricalRuns) {
          runs = await runtime.getHistoricalRuns();
        }

        const formatted = RunHistoryFormatter.formatRunsList(runs);
        setTurns((prev) => [
          ...prev,
          {
            id: `cmd-${Date.now()}`,
            prompt: trimmed,
            response: formatted,
            status: "done"
          }
        ]);
        return;
      }

      if (cmd === "/run") {
        if (!arg) {
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: "✗ Please specify a run ID: /run <id>\n",
              status: "done"
            }
          ]);
          return;
        }

        let run: import("@fecode/agent").DurableRunRecord | null = null;
        if (agent && "getHistoricalRun" in agent) {
          run = await (
            agent as {
              getHistoricalRun: (
                id: string
              ) => Promise<import("@fecode/agent").DurableRunRecord | null>;
            }
          ).getHistoricalRun(arg);
        } else if (runtime && runtime.getHistoricalRun) {
          run = await runtime.getHistoricalRun(arg);
        }

        if (run) {
          const formatted = RunHistoryFormatter.formatRunDetail(run);
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: formatted,
              status: "done"
            }
          ]);
        } else {
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: `✗ Run not found: ${arg}\n`,
              status: "done"
            }
          ]);
        }
        return;
      }

      if (cmd === "/sessions") {
        try {
          const list = await store.list();
          const formatted = SessionHistoryFormatter.formatSessionsList(list);
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: formatted,
              status: "done"
            }
          ]);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: `✗ Error listing sessions: ${msg}\n`,
              status: "done"
            }
          ]);
        }
        return;
      }

      if (cmd === "/delete-session") {
        if (!arg) {
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: "✗ Please specify a session ID to delete.\n",
              status: "done"
            }
          ]);
          return;
        }
        try {
          const deleted = await store.delete(arg);
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: deleted
                ? `✓ Deleted session: ${arg}\n`
                : `✗ Session not found: ${arg}\n`,
              status: "done"
            }
          ]);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: `✗ Error deleting session: ${msg}\n`,
              status: "done"
            }
          ]);
        }
        return;
      }

      if (cmd === "/resume") {
        if (!arg) {
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: "✗ Please specify a session or run ID to resume.\n",
              status: "done"
            }
          ]);
          return;
        }

        // Try SessionStore first
        try {
          const sessionData = await store.load(arg);
          if (sessionData) {
            try {
              const fs = await import("fs/promises");
              await fs.stat(sessionData.workingDirectory);
            } catch {
              setTurns((prev) => [
                ...prev,
                {
                  id: `cmd-${Date.now()}`,
                  prompt: trimmed,
                  response: `⚠ Working directory no longer exists\n\nPath:\n  ${sessionData.workingDirectory}\n`,
                  status: "done"
                }
              ]);
              return;
            }

            if (agent && "restoreSession" in agent) {
              (
                agent as unknown as {
                  restoreSession: (data: typeof sessionData) => void;
                }
              ).restoreSession(sessionData);
            }
            const summary =
              SessionHistoryFormatter.formatResumeSummary(sessionData);
            setTurns((prev) => [
              ...prev,
              {
                id: `cmd-${Date.now()}`,
                prompt: trimmed,
                response: summary,
                status: "done"
              }
            ]);
            return;
          }
        } catch {
          // Fall through to durable run resume
        }

        if (agent && "prepareResume" in agent) {
          try {
            const prep = await (
              agent as {
                prepareResume: (
                  id: string,
                  cwd: string
                ) => Promise<import("@fecode/agent").ResumePreparation>;
              }
            ).prepareResume(arg, cwd);

            if (!prep.canResume) {
              setTurns((prev) => [
                ...prev,
                {
                  id: `cmd-${Date.now()}`,
                  prompt: trimmed,
                  response: `✗ Cannot resume run: ${prep.explanation}\n`,
                  status: "done"
                }
              ]);
            } else {
              setPendingResume({ runId: arg, prep });
              const promptText = RunHistoryFormatter.formatResumePrompt(prep);
              setTurns((prev) => [
                ...prev,
                {
                  id: `cmd-${Date.now()}`,
                  prompt: trimmed,
                  response: `${promptText}\n`,
                  status: "done"
                }
              ]);
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setTurns((prev) => [
              ...prev,
              {
                id: `cmd-${Date.now()}`,
                prompt: trimmed,
                response: `✗ Resume error: ${msg}\n`,
                status: "done"
              }
            ]);
          }
        }
        return;
      }

      if (cmd === "/replan") {
        if (agent && "prepareReplan" in agent) {
          try {
            const assessment = await (
              agent as {
                prepareReplan: (
                  id?: string,
                  opts?: { cwd: string }
                ) => Promise<import("@fecode/agent").ReplanAssessment>;
              }
            ).prepareReplan(arg || undefined, { cwd });

            if (!assessment.eligible) {
              setTurns((prev) => [
                ...prev,
                {
                  id: `cmd-${Date.now()}`,
                  prompt: trimmed,
                  response: `✗ Replanning not eligible: ${assessment.reason}\n`,
                  status: "done"
                }
              ]);
            } else {
              setPendingReplan({ planId: arg || "active-plan", assessment });
              const promptText = PlanFormatter.formatReplanPrompt(assessment);
              const replanNotice = PlanFormatter.formatReplanNotice();
              setTurns((prev) => [
                ...prev,
                {
                  id: `cmd-${Date.now()}`,
                  prompt: trimmed,
                  response: `${replanNotice}\n\n${promptText}\n`,
                  status: "done"
                }
              ]);
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setTurns((prev) => [
              ...prev,
              {
                id: `cmd-${Date.now()}`,
                prompt: trimmed,
                response: `✗ Replan error: ${msg}\n`,
                status: "done"
              }
            ]);
          }
        }
        return;
      }

      if (cmd === "/plan") {
        setActiveView("plan");
        if (arg) {
          let summary: import("@fecode/agent").RunSummary | undefined;
          if (
            agent &&
            "getRunSummary" in agent &&
            typeof (
              agent as unknown as {
                getRunSummary: (
                  id: string
                ) => import("@fecode/agent").RunSummary | undefined;
              }
            ).getRunSummary === "function"
          ) {
            summary = (
              agent as unknown as {
                getRunSummary: (
                  id: string
                ) => import("@fecode/agent").RunSummary | undefined;
              }
            ).getRunSummary(arg);
          } else if (runtime && runtime.getDiagnosticsSummary) {
            summary = runtime.getDiagnosticsSummary(arg);
          }

          if (summary) {
            const lines: string[] = [
              `Task Plan for Run: ${summary.runId}`,
              `Plan ID:        ${summary.planId || "unknown"}`,
              `Status:         ${summary.planStatus || "unknown"}`,
              `Progress:       ${summary.completedPlanSteps ?? 0}/${summary.totalPlanSteps ?? 0} completed`
            ];
            if (summary.planSummary) {
              lines.push(`Summary:        ${summary.planSummary}`);
            }
            setTurns((prev) => [
              ...prev,
              {
                id: `cmd-${Date.now()}`,
                prompt: trimmed,
                response: lines.join("\n") + "\n",
                status: "done"
              }
            ]);
            return;
          }
        }

        let activePlan: import("@fecode/agent").TaskPlan | undefined;
        if (
          agent &&
          "getTaskPlan" in agent &&
          typeof (
            agent as unknown as {
              getTaskPlan: () => import("@fecode/agent").TaskPlan | undefined;
            }
          ).getTaskPlan === "function"
        ) {
          activePlan = (
            agent as {
              getTaskPlan: () => import("@fecode/agent").TaskPlan | undefined;
            }
          ).getTaskPlan();
        }

        if (activePlan) {
          const detail = PlanFormatter.formatPlanDetail(activePlan);
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: detail,
              status: "done"
            }
          ]);
        } else {
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: trimmed,
              response: "No active plan found.\n",
              status: "done"
            }
          ]);
        }
        return;
      }

      // Unknown command
      setTurns((prev) => [
        ...prev,
        {
          id: `cmd-${Date.now()}`,
          prompt: trimmed,
          response: `✗ Unknown command: ${cmd}. Type /help for available commands.\n`,
          status: "done"
        }
      ]);
      return;
    }

    // Standard task submission
    setQuery("");
    setIsGenerating(true);
    const nextTaskCount = taskCount + 1;
    setTaskCount(nextTaskCount);
    setActiveRequest(trimmed);
    setLastTaskStatus("in_progress");

    let initialResponse = "";
    let riskAssessment: import("@fecode/agent").TaskRiskAssessment | undefined;
    if (
      agent &&
      "assessTaskRisk" in agent &&
      typeof (
        agent as unknown as {
          assessTaskRisk: (
            ctx: import("@fecode/agent").TaskRiskContext
          ) => import("@fecode/agent").TaskRiskAssessment;
        }
      ).assessTaskRisk === "function"
    ) {
      try {
        riskAssessment = (
          agent as unknown as {
            assessTaskRisk: (
              ctx: import("@fecode/agent").TaskRiskContext
            ) => import("@fecode/agent").TaskRiskAssessment;
          }
        ).assessTaskRisk({
          userMessage: trimmed,
          cwd,
          affectedFiles: [],
          operations: []
        });
      } catch {
        // ignore
      }
    } else {
      const isDepChange =
        trimmed.includes("npm install") ||
        trimmed.includes("yarn add") ||
        trimmed.includes("pnpm add") ||
        trimmed.includes("dependencies");
      if (isDepChange) {
        riskAssessment = {
          level: "elevated",
          reasons: ["Modifies project dependencies or configuration"],
          affectedFiles: 1,
          requiresCheckpoint: true,
          requiresExplicitApproval: true
        };
      }
    }

    if (
      riskAssessment &&
      (riskAssessment.level === "elevated" ||
        riskAssessment.level === "critical")
    ) {
      const riskHeader = `${riskAssessment.level === "critical" ? "Critical" : "Elevated"}-risk task\n`;
      const cpReq = riskAssessment.requiresCheckpoint
        ? "Checkpoint required\n"
        : "";
      initialResponse = `${riskHeader}${cpReq}\n`;
    }

    const turnId = `turn-${Date.now()}`;
    const newTurn: Turn = {
      id: turnId,
      prompt: trimmed,
      response: initialResponse,
      status: "streaming"
    };
    setTurns((prev) => [...prev, newTurn]);

    try {
      if (!agent) {
        throw new Error(configError || "Agent runtime is not initialized.");
      }

      const stream = agent.run({
        message: trimmed,
        cwd,
        sessionId
      });

      for await (const event of stream) {
        if (event.type === "text") {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? { ...t, response: t.response + event.content }
                : t
            )
          );
        } else if (event.type === "error") {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    status: "error",
                    error: `✗ ${event.error.message}`
                  }
                : t
            )
          );
          setLastTaskStatus("blocked");
        } else if (event.type === "approval_required") {
          setPendingApproval(event.request);
        } else if (
          event.type === "checkpoint_approval_requested" ||
          event.type === "execution_handoff_waiting_approval"
        ) {
          setPendingApproval({
            id: "checkpointId" in event ? event.checkpointId : "req-cp",
            toolName: "checkpoint",
            category: "write",
            arguments: {},
            reason: event.reason
          });
        } else if (event.type === "tool_result") {
          if (event.result.success) {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === turnId
                  ? {
                      ...t,
                      response: t.response.includes("✓ tool")
                        ? t.response
                        : t.response + "✓ tool executed\n"
                    }
                  : t
              )
            );
          } else if (event.result.error) {
            const errCode = event.result.error.code;
            let recoveryMsg = "";
            if (errCode === "NOT_FOUND") {
              recoveryMsg = "⚠ read_file: File not found — searching again\n";
            } else if (errCode === "EDIT_CONFLICT") {
              recoveryMsg = "⚠ edit_file: Edit conflict — refreshing file context\n";
            } else if (errCode === "REPEATED_CALL_LOOP") {
              recoveryMsg = "⚠ search_files: Repeated call loop detected — adapting strategy\n";
            } else if (errCode === "COMMAND_TIMEOUT") {
              recoveryMsg = "⚠ execute_command: Command timed out\n";
            }
            if (recoveryMsg) {
              setTurns((prev) =>
                prev.map((t) =>
                  t.id === turnId
                    ? { ...t, response: t.response + recoveryMsg }
                    : t
                )
              );
            }
          }
        } else if (event.type === "plan_created") {
          const planSummary = `Plan: ${event.plan.objective}\n\n`;
          const formattedPlan = PlanFormatter.formatPlanDetail(event.plan);
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    response:
                      (t.response ? t.response + "\n\n" : "") +
                      planSummary +
                      formattedPlan +
                      "\n"
                  }
                : t
            )
          );
        } else if (event.type === "final_reconciliation_failed") {
          const plan =
            (agent &&
            "getTaskPlan" in agent &&
            typeof (agent as unknown as { getTaskPlan: () => import("@fecode/agent").TaskPlan | undefined }).getTaskPlan === "function"
              ? (agent as unknown as { getTaskPlan: () => import("@fecode/agent").TaskPlan | undefined }).getTaskPlan()
              : undefined) || {
              planId: event.result.planId,
              runId: event.result.runId,
              createdAt: Date.now(),
              userRequestSummary: "Reconciliation failed",
              objective: "Reconciliation failed",
              status: "blocked",
              steps: [],
              risks: []
            };
          const defaultAdaptation: import("@fecode/agent").PlanAdaptationAssessment = {
            planId: event.result.planId,
            assessedAt: Date.now(),
            canContinue: false,
            canRetry: false,
            canAdapt: true,
            feedback: [],
            affectedSteps: event.result.missingFiles || [],
            currentRiskLevel: "normal",
            requiresUserConfirmation: true,
            recommendedAction: "replan"
          };
          setPendingPlanBlocked({
            plan,
            assessment: defaultAdaptation,
            reconciliationResult: event.result
          });
          const promptText = PlanFormatter.formatReconciliationBlockedPrompt(
            plan,
            event.result
          );
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    response:
                      (t.response ? t.response + "\n\n" : "") + promptText + "\n"
                  }
                : t
            )
          );
        } else if (
          event.type === "plan_blocked" ||
          event.type === "plan_adaptation_required"
        ) {
          const plan =
            (agent &&
            "getTaskPlan" in agent &&
            typeof (agent as unknown as { getTaskPlan: () => import("@fecode/agent").TaskPlan | undefined }).getTaskPlan === "function"
              ? (agent as unknown as { getTaskPlan: () => import("@fecode/agent").TaskPlan | undefined }).getTaskPlan()
              : undefined) || {
              planId: event.planId,
              runId: "runId" in event ? (event as unknown as { runId: string }).runId : "run",
              createdAt: Date.now(),
              userRequestSummary: "Blocked plan",
              objective: "Blocked plan",
              status: "blocked",
              steps: [],
              risks: []
            };
          const planId = event.planId;
          const runId = "runId" in event ? (event as unknown as { runId: string }).runId : "run";
          const assessment: import("@fecode/agent").PlanAdaptationAssessment = {
            planId,
            assessedAt: Date.now(),
            canContinue: true,
            canRetry: true,
            canAdapt: true,
            feedback: [
              {
                feedbackId: "fb-1",
                runId,
                planId,
                kind: "verification_failed",
                severity: "blocking",
                summary: event.reason,
                detectedAt: Date.now(),
                requiresReplanning: true,
                requiresUserConfirmation: true,
                recommendedAction: "replan"
              }
            ],
            affectedSteps: event.affectedSteps || [],
            currentRiskLevel: "normal",
            requiresUserConfirmation: true,
            recommendedAction: "replan"
          };
          setPendingPlanBlocked({ plan, assessment });
          const promptText = PlanFormatter.formatPlanBlockedPrompt(
            plan,
            assessment
          );
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    response:
                      (t.response ? t.response + "\n\n" : "") + promptText + "\n"
                  }
                : t
            )
          );
        } else if (event.type === "plan_execution_started") {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    response:
                      t.response +
                      `Plan approved. Executing ${event.totalSteps} steps...\n\n`
                  }
                : t
            )
          );
        } else if (event.type === "plan_step_started") {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    response:
                      t.response +
                      `[${event.stepIndex + 1}] ${event.title || "Step"}\nEXECUTING\n`
                  }
                : t
            )
          );
        } else if (event.type === "plan_step_completed") {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    response: t.response + "✓ COMPLETED\n\n"
                  }
                : t
            )
          );
        } else if (event.type === "plan_step_skipped") {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    response:
                      t.response +
                      `⊘ SKIPPED (${event.reason || "Skipped"})\n\n`
                  }
                : t
            )
          );
        } else if (event.type === "plan_execution_completed") {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    response:
                      t.response +
                      `✓ Plan completed (${event.completedSteps}/${event.totalSteps} steps).\n`
                  }
                : t
            )
          );
        } else if (event.type === "execution_feedback_detected") {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    response: t.response + `⚠ Feedback: ${event.summary}\n`
                  }
                : t
            )
          );
        } else if (event.type === "step_retry_started") {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    response:
                      t.response +
                      `⟳ Retrying Step ${event.stepId} (attempt ${event.attempt}/${event.maxAttempts}): ${event.reason}\n`
                  }
                : t
            )
          );
        } else if (event.type === "step_retry_completed") {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    response:
                      t.response +
                      (event.success
                        ? `✓ Step retry succeeded on attempt ${event.attempt}\n`
                        : `✗ Step retry failed on attempt ${event.attempt}\n`)
                  }
                : t
            )
          );
        } else if (event.type === "task_summary") {
          let summaryHeader = "";
          if (event.summary.status === "completed") {
            summaryHeader = "✓ Task completed\n\n";
          } else if (event.summary.status === "blocked") {
            summaryHeader = "⚠ Task blocked\n\n";
          } else if (event.summary.status === "cancelled") {
            summaryHeader = "⊘ Task cancelled\n\n";
          }

          let summaryFormatted = SessionHistoryFormatter.formatTaskDetail(
            event.summary
          );
          if (
            event.summary.verifiedCommands &&
            event.summary.verifiedCommands.length > 0
          ) {
            summaryFormatted = summaryFormatted.replace(
              "Verification:",
              "Verified:"
            );
          }
          const fullSummary = summaryHeader + summaryFormatted;
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    response:
                      (t.response ? t.response + "\n\n" : "") +
                      fullSummary +
                      "\n"
                  }
                : t
            )
          );
          setCompletedSummaries((prev) => [...prev, event.summary]);
          setLastTaskStatus(event.summary.status);
          persistState(event.summary.status, event.summary, nextTaskCount).catch(
            () => {}
          );
        } else if (event.type === "done") {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId ? { ...t, status: "done" } : t
            )
          );
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? { ...t, status: "error", error: `✗ ${msg}` }
            : t
        )
      );
      setLastTaskStatus("blocked");
    } finally {
      setIsGenerating(false);
      setActiveRequest(undefined);
    }
  };

  return (
    <AppShell
      header={
        <Header
          projectName="fecode"
          providerName={providerName}
          modelName={modelName}
          cwd={cwd}
          status={uiState?.status || lastTaskStatus}
          sessionId={sessionId}
        />
      }
      modal={
        hasModal ? (
          <Box flexDirection="column">
            {pendingApproval && (
              <ApprovalPrompt
                toolName={pendingApproval.toolName}
                reason={pendingApproval.reason}
                changeReview={
                  pendingApproval.changeReview as
                    | import("./ui/ApprovalPrompt.js").ApprovalPromptProps["changeReview"]
                    | undefined
                }
                value={approvalInput}
                onChange={setApprovalInput}
                onSubmit={handleApprovalSubmit}
              />
            )}

            {pendingPlanBlocked && (
              <BlockedView
                planId={pendingPlanBlocked.plan.planId}
                stepInfo={`${pendingPlanBlocked.plan.steps.find((s) => s.status === "in_progress")?.order || 1}/${pendingPlanBlocked.plan.steps.length}`}
                reason={pendingPlanBlocked.assessment.feedback[0]?.summary}
                affectedSteps={pendingPlanBlocked.assessment.affectedSteps}
                isReconciliation={Boolean(
                  pendingPlanBlocked.reconciliationResult
                )}
                value={blockedInput}
                onChange={setBlockedInput}
                onSubmit={handleSubmit}
              />
            )}

            {pendingRecovery && (
              <RecoveryView
                strategy={pendingRecovery.assessment.strategy}
                outcome={pendingRecovery.assessment.eligible ? "ELIGIBLE" : "NOT_ELIGIBLE"}
                value={recoveryInput}
                onChange={setRecoveryInput}
                onSubmit={handleSubmit}
              />
            )}

            {pendingRecoveryContinuation && (
              <RecoveryView
                isAwaitingContinuation={true}
                remainingStepsCount={
                  pendingRecoveryContinuation.preparation.remainingSteps.length
                }
                value={recoveryInput}
                onChange={setRecoveryInput}
                onSubmit={handleSubmit}
              />
            )}

            {pendingReplan && (
              <ReplanView
                originalPlanId={pendingReplan.planId}
                reason={pendingReplan.assessment.reason}
                replanDepth={pendingReplan.assessment.replanDepth}
                value={replanInput}
                onChange={setReplanInput}
                onSubmit={handleSubmit}
              />
            )}

            {pendingResume && (
              <ResumeView
                runId={pendingResume.runId}
                originalRequest={
                  pendingResume.prep.originalRun.userRequestSummary
                }
                riskLevel={pendingResume.prep.reassessedRisk.level}
                value={resumeInput}
                onChange={setResumeInput}
                onSubmit={handleSubmit}
              />
            )}
          </Box>
        ) : null
      }
      footer={
        <StatusBar
          status={uiState?.status || lastTaskStatus}
          isGenerating={isGenerating}
        />
      }
    >
      {/* Content Area */}
      {activeView === "help" && <HelpView />}

      {activeView === "runs" && (
        <RunHistoryView
          runs={
            uiState?.diagnostics
              ? [
                  {
                    runId: uiState.diagnostics.runId,
                    status: uiState.diagnostics.finalStatus || "executing",
                    userRequestSummary: uiState.diagnostics.userRequestSummary,
                    durationMs: uiState.diagnostics.durationMs
                  }
                ]
              : []
          }
        />
      )}

      {activeView === "diagnostics" && (
        <DiagnosticsView summary={uiState?.diagnostics} />
      )}

      {activeView === "plan" && uiState?.activePlan && (
        <PlanView
          planId={uiState.activePlan.planId}
          objective={uiState.activePlan.objective}
          summary={uiState.activePlan.userRequestSummary}
          status={uiState.activePlan.status}
          steps={uiState.activePlan.steps}
          completedCount={uiState.activePlan.completedStepsCount}
          totalCount={uiState.activePlan.totalStepsCount}
        />
      )}

      {/* Main Turns / Streaming execution */}
      <Box flexDirection="column">
        {turns.map((turn, idx) => (
          <TurnView
            key={turn.id}
            prompt={turn.prompt}
            response={turn.response}
            status={turn.status}
            error={turn.error}
            isLast={idx === turns.length - 1}
          />
        ))}

        {/* Thinking Indicator — shown while generating */}
        {isGenerating && (
          <Box marginTop={0}>
            <ThinkingIndicator isActive={isGenerating} label="Agent is working..." />
          </Box>
        )}

        {/* Task Input Prompt */}
        {!hasModal && (
          <TaskInput
            value={query}
            onChange={handleQueryChange}
            onSubmit={handleSubmit}
            isDisabled={Boolean(pendingQuery)}
            placeholder={
              isGenerating
                ? "Type next task (will be queued)..."
                : "Describe task or type /help..."
            }
            label={turns.length === 0 ? "Task" : undefined}
            pendingQuery={pendingQuery}
            suggestions={commandSuggestions}
            selectedSuggestion={selectedSuggestion}
          />
        )}
      </Box>
    </AppShell>
  );
};
