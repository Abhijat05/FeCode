import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
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
  RunHistoryFormatter,
  PlanFormatter,
  transitionPlanStatus,
  DefaultProductRuntime,
  createInitialUIState,
  reduceUIState,
  getProjectIdentifier,
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
  CurrentStepView,
  WorkspaceStatus,
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
  thinkingMs?: number;
  thinkingTokens?: number;
  thinkingSummary?: string;
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
  sessionId?: string;
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
  sessionId: sessionIdProp,
  gitRepository: gitRepoProp,
  checkpointManager: checkpointManagerProp,
  recoveryManager: recoveryManagerProp,
  executionPolicy: executionPolicyProp
}) => {
  const gitRepo = useMemo(
    () => gitRepoProp || new DefaultGitRepository(),
    [gitRepoProp]
  );
  const cpManager = useMemo(
    () =>
      checkpointManagerProp ||
      (agent && "getCheckpointManager" in agent && typeof (agent as unknown as { getCheckpointManager: () => CheckpointManager }).getCheckpointManager === "function"
        ? (agent as unknown as { getCheckpointManager: () => CheckpointManager }).getCheckpointManager()
        : new DefaultCheckpointManager(undefined, gitRepo)),
    [checkpointManagerProp, agent, gitRepo]
  );
  const recManager = useMemo(
    () =>
      recoveryManagerProp ||
      (agent && "getRecoveryManager" in agent && typeof (agent as unknown as { getRecoveryManager: () => RecoveryManager }).getRecoveryManager === "function"
        ? (agent as unknown as { getRecoveryManager: () => RecoveryManager }).getRecoveryManager()
        : new DefaultRecoveryManager(undefined, gitRepo)),
    [recoveryManagerProp, agent, gitRepo]
  );
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
        initialSessionId: sessionIdProp || initialSessionData?.sessionId
      });
    }
    return undefined as unknown as ProductRuntime;
  });

  const { exit } = useApp();
  const [query, setQuery] = useState("");
  const [activeView, setActiveView] = useState<
    "main" | "plan" | "runs" | "diagnostics" | "help" | "git"
  >("main");
  const [historicalRuns, setHistoricalRuns] = useState<
    import("./ui/RunHistoryView.js").HistoricalRunItem[]
  >([]);
  const [runsIsAll, setRunsIsAll] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | undefined>(undefined);
  const [diagnosticsSummary, setDiagnosticsSummary] = useState<
    import("@fecode/agent").RunSummary | undefined
  >(undefined);
  const [planFormattedOutput, setPlanFormattedOutput] = useState<
    string | undefined
  >(undefined);
  const [gitFormattedOutput, setGitFormattedOutput] = useState<
    string | undefined
  >(undefined);

  useEffect(() => {
    if (activeView === "git") {
      (async () => {
        try {
          const statusResult = await gitRepo.getStatus(cwd);
          const formatted = GitStatusFormatter.formatGitStatus(statusResult);
          setGitFormattedOutput(formatted);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setGitFormattedOutput(`✗ Git error: ${msg}\n`);
        }
      })();
    }
  }, [activeView, cwd, gitRepo]);

  useEffect(() => {
    let isCurrent = true;
    if (activeView === "runs") {
      (async () => {
        try {
          const pid = await getProjectIdentifier(cwd, gitRepo);
          if (!isCurrent) return;
          setCurrentProjectId(pid);
          let runs: import("@fecode/agent").DurableRunRecord[] = [];
          if (
            agent &&
            "listHistoricalRuns" in agent &&
            typeof (
              agent as unknown as {
                listHistoricalRuns: (options?: {
                  projectId?: string;
                  limit?: number;
                  allProjects?: boolean;
                }) => Promise<import("@fecode/agent").DurableRunRecord[]>;
              }
            ).listHistoricalRuns === "function"
          ) {
            runs = await (
              agent as {
                listHistoricalRuns: (options?: {
                  projectId?: string;
                  limit?: number;
                  allProjects?: boolean;
                }) => Promise<import("@fecode/agent").DurableRunRecord[]>;
              }
            ).listHistoricalRuns({
              projectId: runsIsAll ? undefined : pid,
              allProjects: runsIsAll
            });
          } else if (runtime && runtime.getHistoricalRuns) {
            runs = await runtime.getHistoricalRuns({
              projectId: runsIsAll ? undefined : pid,
              allProjects: runsIsAll
            });
          }
          if (!isCurrent) return;
          setHistoricalRuns(
            runs.map((r) => ({
              runId: r.runId,
              status: r.finalStatus || r.executionState || "unknown",
              userRequestSummary: r.userRequestSummary,
              durationMs: r.durationMs,
              startedAt: r.startedAt,
              projectId: r.projectId
            }))
          );
        } catch {
          // ignore
        }
      })();
    } else if (activeView === "diagnostics") {
      try {
        let summary: import("@fecode/agent").RunSummary | undefined;
        if (
          agent &&
          "getRunSummary" in agent &&
          typeof (
            agent as unknown as {
              getRunSummary: (
                id?: string
              ) => import("@fecode/agent").RunSummary | undefined;
            }
          ).getRunSummary === "function"
        ) {
          summary = (
            agent as {
              getRunSummary: (
                id?: string
              ) => import("@fecode/agent").RunSummary | undefined;
            }
          ).getRunSummary();
        } else if (runtime && runtime.getDiagnosticsSummary) {
          summary = runtime.getDiagnosticsSummary();
        }
        if (summary && isCurrent) {
          setDiagnosticsSummary(summary);
        }
      } catch {
        // ignore
      }
    }
    return () => {
      isCurrent = false;
    };
  }, [activeView, cwd, gitRepo, runsIsAll]);
  const [store] = useState<SessionStore>(
    () => sessionStore || new DefaultSessionStore()
  );
  const [sessionId] = useState<string>(
    () =>
      sessionIdProp ||
      initialSessionData?.sessionId ||
      `session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
  );
  const [taskCount, setTaskCount] = useState<number>(
    () => initialSessionData?.taskCount || 0
  );
  const [completedSummaries, setCompletedSummaries] = useState<
    TaskCompletionSummary[]
  >(() => initialSessionData?.completedTaskSummaries || []);
  const completedSummariesRef = useRef<TaskCompletionSummary[]>(
    initialSessionData?.completedTaskSummaries || []
  );
  useEffect(() => {
    completedSummariesRef.current = completedSummaries;
  }, [completedSummaries]);
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
  const [isThinking, setIsThinking] = useState(false);
  const [executionStartTime, setExecutionStartTime] = useState<number | undefined>(undefined);
  const [activeElapsedMs, setActiveElapsedMs] = useState<number | undefined>(undefined);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [scrolledTurnId, setScrolledTurnId] = useState<string | null>(null);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const draftPromptRef = useRef<string>("");
  const prevIsGeneratingRef = useRef(false);
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

  const isTestEnv = Boolean(process.env.VITEST);
  const terminalRows = process.stdout?.rows || 24;
  const availableTurnRows = Math.max(4, terminalRows - 14);

  const { visibleTurns, hiddenTurnsCount } = useMemo(() => {
    if (isTestEnv || turns.length === 0) {
      return { visibleTurns: turns, hiddenTurnsCount: 0 };
    }
    let accumulatedLines = 0;
    let startIndex = turns.length - 1;
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      const pLines = (turn.prompt || "").split("\n").length;
      const rLines = (turn.response || "").split("\n").length;
      const total = pLines + rLines + 4;
      if (accumulatedLines + total > availableTurnRows && i < turns.length - 1) {
        break;
      }
      accumulatedLines += total;
      startIndex = i;
    }
    const sliced = turns.slice(startIndex);
    if (!isTestEnv && sliced.length > 0) {
      const lastIdx = sliced.length - 1;
      const last = sliced[lastIdx];
      const rLines = (last.response || "").split("\n");
      const pLinesCount = (last.prompt || "").split("\n").length;
      const maxRespLines = Math.max(3, availableTurnRows - pLinesCount - 4);
      if (rLines.length > maxRespLines) {
        sliced[lastIdx] = {
          ...last,
          response: isGenerating
            ? "… [earlier output hidden while generating]\n" + rLines.slice(-maxRespLines).join("\n")
            : rLines.slice(0, maxRespLines).join("\n") + `\n… [${rLines.length - maxRespLines} lines omitted; use PageUp/Down to scroll]`
        };
      }
    }
    return {
      visibleTurns: sliced,
      hiddenTurnsCount: startIndex
    };
  }, [turns, isTestEnv, availableTurnRows, isGenerating]);

  const commandSuggestions: CommandDef[] =
    !isGenerating && !hasModal && query.startsWith("/") && !query.includes(" ")
      ? filterCommands(query)
      : [];

  const handleQueryChange = (rawVal: string) => {
    if (scrollOffset > 0) {
      setScrollOffset(0);
      setScrolledTurnId(null);
    }
    // Sanitize any raw ANSI, bracketed paste, or mouse escape sequences from leaking into input
    let val = rawVal;
    /* eslint-disable no-control-regex */
    if (
      val.includes("[200~") ||
      val.includes("[201~") ||
      val.includes("[<") ||
      val.includes("\x1b")
    ) {
      val = val
        .replace(/\x1b?\[200~/g, "")
        .replace(/\x1b?\[201~/g, "")
        .replace(/\x1b?\[<\d+;\d+;\d+[Mm]/g, "")
        .replace(/\x1b/g, "");
    }
    /* eslint-enable no-control-regex */
    if (val.includes("\n") || val.includes("\r")) {
      val = val.replace(/\r?\n/g, " ");
    }

    if (!hasModal && !isGenerating && activeView === "main" && query === "" && val === "?") {
      setActiveView("help");
      setQuery("");
      setSelectedSuggestion(0);
      return;
    }
    if (!hasModal && !isGenerating && activeView !== "main" && !val.startsWith("/") && val.length === 1) {
      const char = val.toLowerCase();
      if (char === "p") {
        setActiveView(activeView === "plan" ? "main" : "plan");
        setQuery("");
        setSelectedSuggestion(0);
        return;
      }
      if (char === "r") {
        setActiveView(activeView === "runs" ? "main" : "runs");
        setQuery("");
        setSelectedSuggestion(0);
        return;
      }
      if (char === "d") {
        setActiveView(activeView === "diagnostics" ? "main" : "diagnostics");
        setQuery("");
        setSelectedSuggestion(0);
        return;
      }
      if (char === "?" || char === "h") {
        setActiveView(activeView === "help" ? "main" : "help");
        setQuery("");
        setSelectedSuggestion(0);
        return;
      }
    }
    setQuery(val);
    setSelectedSuggestion(0);
  };

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

  // Ensure mouse reporting is disabled to prevent terminal mouse sequences from leaking into input
  useEffect(() => {
    if (process.stdout?.isTTY && !process.env.VITEST && !process.env.CI_TEST_MODE) {
      try {
        process.stdout.write("\x1B[?1000l\x1B[?1006l");
      } catch {
        // ignore
      }
    }
  }, []);

  // Track active execution elapsed time for Header
  useEffect(() => {
    if (!isGenerating || !executionStartTime || hasModal || scrollOffset > 0) {
      if (!isGenerating || !executionStartTime) {
        setActiveElapsedMs(undefined);
      }
      return;
    }
    setActiveElapsedMs(Date.now() - executionStartTime);
    const timer = setInterval(() => {
      setActiveElapsedMs(Date.now() - executionStartTime);
    }, 1000);
    return () => clearInterval(timer);
  }, [isGenerating, executionStartTime, hasModal, scrollOffset]);

  const persistState = useCallback(
    async (
      status: SessionStatus,
      newSummary?: TaskCompletionSummary,
      explicitTaskCount?: number
    ) => {
      try {
        const summaries = newSummary
          ? [...completedSummariesRef.current, newSummary]
          : completedSummariesRef.current;
        if (newSummary) {
          completedSummariesRef.current = summaries;
          setCompletedSummaries(summaries);
        }
        const state = (
          agent as { getState?: () => { messages?: ModelMessage[] } }
        )?.getState?.();
        const rawMessages = state?.messages || [];

        // Sanitize messages and summaries to avoid persisting empty records
        const validSummaries = summaries.filter(
          (s) => s && (s.request || s.status || s.taskId)
        );
        const validMessages = rawMessages.filter((m) => {
          if (!m) return false;
          if (typeof m.content === "string") {
            return (
              m.content.trim().length > 0 ||
              Boolean(m.toolCalls && m.toolCalls.length > 0)
            );
          }
          return true;
        });

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
          completedTaskSummaries: validSummaries,
          messages: validMessages
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
      agent
    ]
  );

  const handleExit = useCallback(async () => {
    try {
      await persistState(lastTaskStatus);
    } catch {
      // ignore
    }
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
        const clamped = Math.max(0, Math.min(selectedSuggestion, commandSuggestions.length - 1));
        const selected = commandSuggestions[clamped];
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
          prev <= 0 ? commandSuggestions.length - 1 : prev - 1
        );
        return;
      }

      // Ctrl+P / Ctrl+N: Navigate shell-style prompt history
      if (key.ctrl && input === "p" && activeView === "main" && !isGenerating && !hasModal) {
        if (promptHistory.length > 0) {
          const nextIndex = historyIndex === -1 ? promptHistory.length - 1 : Math.max(0, historyIndex - 1);
          if (historyIndex === -1) {
            draftPromptRef.current = query;
          }
          setHistoryIndex(nextIndex);
          setQuery(promptHistory[nextIndex]);
        }
        return;
      }

      if (key.ctrl && input === "n" && activeView === "main" && !isGenerating && !hasModal) {
        if (historyIndex !== -1) {
          if (historyIndex >= promptHistory.length - 1) {
            setHistoryIndex(-1);
            setQuery(draftPromptRef.current);
          } else {
            const nextIndex = historyIndex + 1;
            setHistoryIndex(nextIndex);
            setQuery(promptHistory[nextIndex]);
          }
        }
        return;
      }

      // Mouse Wheel Up / PageUp / Shift+Up / Ctrl+U / Up Arrow: Scroll history up
      const isMouseWheelUp = input.includes("<64;") || input.startsWith("[<64;");
      const isMouseWheelDown = input.includes("<65;") || input.startsWith("[<65;");

      const isUpScroll =
        (key.pageUp ||
          (key.shift && key.upArrow) ||
          (key.ctrl && input === "u") ||
          input === "\u001B[5~" ||
          isMouseWheelUp ||
          (key.upArrow && commandSuggestions.length === 0 && (!query || isGenerating || scrollOffset > 0))) &&
        activeView === "main" &&
        turns.length > 0;

      if (isUpScroll) {
        if (key.ctrl && input === "u") {
          const newOffset = Math.max(0, turns.length - 1);
          setScrollOffset(newOffset);
          const targetIndex = turns.length - 1 - newOffset;
          setScrolledTurnId(turns[targetIndex]?.id || null);
        } else {
          setScrollOffset((prev) => {
            const next = Math.min(prev + 1, Math.max(0, turns.length - 1));
            const targetIndex = turns.length - 1 - next;
            setScrolledTurnId(turns[targetIndex]?.id || null);
            return next;
          });
        }
        return;
      }

      // Mouse Wheel Down / PageDown / Shift+Down / Ctrl+D / Down Arrow: Scroll history down towards live output
      const isDownScroll =
        (key.pageDown ||
          (key.shift && key.downArrow) ||
          (key.ctrl && input === "d") ||
          input === "\u001B[6~" ||
          isMouseWheelDown ||
          (key.downArrow && scrollOffset > 0)) &&
        activeView === "main" &&
        turns.length > 0;

      if (isDownScroll) {
        if (key.ctrl && input === "d") {
          setScrollOffset(0);
          setScrolledTurnId(null);
        } else {
          setScrollOffset((prev) => {
            const next = Math.max(0, prev - 1);
            if (next === 0) {
              setScrolledTurnId(null);
            } else {
              const targetIndex = turns.length - 1 - next;
              setScrolledTurnId(turns[targetIndex]?.id || null);
            }
            return next;
          });
        }
        return;
      }

      // Home: scroll to oldest turn
      if ((input === "\u001B[H" || input === "\u001B[1~") && activeView === "main" && turns.length > 0) {
        const newOffset = Math.max(0, turns.length - 1);
        setScrollOffset(newOffset);
        const targetIndex = turns.length - 1 - newOffset;
        setScrolledTurnId(turns[targetIndex]?.id || null);
        return;
      }

      // End: return to live bottom view
      if ((input === "\u001B[F" || input === "\u001B[4~" || input === "\u001B[8~") && scrollOffset > 0) {
        setScrollOffset(0);
        setScrolledTurnId(null);
        return;
      }

      const cancelActiveModal = (): boolean => {
        if (pendingApproval) {
          if (approvalResolver) {
            approvalResolver.cancelPending("Approval request cancelled via Ctrl+C");
          }
          setPendingApproval(null);
          setApprovalInput("");
          return true;
        }

        if (pendingPlanBlocked) {
          const pb = pendingPlanBlocked;
          setPendingPlanBlocked(null);
          setBlockedInput("");
          try {
            if (agent && "resolveExecutionDecision" in agent) {
              void (
                agent as {
                  resolveExecutionDecision: (
                    id: string,
                    d: string,
                    opts?: { cwd: string }
                  ) => Promise<unknown>;
                }
              )
                .resolveExecutionDecision(pb.plan.planId, "cancel", { cwd })
                .catch(() => {});
            }
            if (agent && "cancel" in agent) {
              void agent.cancel().catch(() => {});
            }
          } catch {
            // ignore
          }
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: "",
              response: `${PlanFormatter.formatCancelNotice()}\n`,
              status: "done"
            }
          ]);
          return true;
        }

        if (pendingRecovery) {
          setPendingRecovery(null);
          setRecoveryInput("");
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: "",
              response: "✓ Recovery cancelled\n",
              status: "done"
            }
          ]);
          return true;
        }

        if (pendingRecoveryContinuation) {
          setPendingRecoveryContinuation(null);
          setRecoveryInput("");
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: "",
              response: "Continuation cancelled.\n",
              status: "done"
            }
          ]);
          return true;
        }

        if (pendingReplan) {
          setPendingReplan(null);
          setReplanInput("");
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: "",
              response: "Replanning cancelled.\n",
              status: "done"
            }
          ]);
          return true;
        }

        if (pendingResume) {
          setPendingResume(null);
          setResumeInput("");
          setTurns((prev) => [
            ...prev,
            {
              id: `cmd-${Date.now()}`,
              prompt: "",
              response: "✗ Resume cancelled by user.\n",
              status: "done"
            }
          ]);
          return true;
        }

        return false;
      };

      // Ctrl+C cancellation
      if (key.ctrl && input === "c") {
        if (pendingQuery) {
          setPendingQuery(null);
          return;
        }

        if (cancelActiveModal()) {
          return;
        }

        if (isGenerating && agent) {
          agent.cancel().catch(() => {});
          setIsGenerating(false);
          setIsThinking(false);
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

      // Non-main view navigation shortcuts: p, r, d, ?, Esc (only when not typing a slash command)
      if (!hasModal && !isGenerating && activeView !== "main" && !query.startsWith("/")) {
        if (input === "p" || input === "P") {
          setActiveView(activeView === "plan" ? "main" : "plan");
          setQuery("");
          return;
        }
        if (input === "r" || input === "R") {
          setActiveView(activeView === "runs" ? "main" : "runs");
          setQuery("");
          return;
        }
        if (input === "d" || input === "D") {
          setActiveView(activeView === "diagnostics" ? "main" : "diagnostics");
          setQuery("");
          return;
        }
        if (input === "?" || input === "h" || input === "H") {
          setActiveView(activeView === "help" ? "main" : "help");
          setQuery("");
          return;
        }
      }

      // Quick help shortcut from empty query on main view
      if (!hasModal && !isGenerating && activeView === "main" && query === "" && input === "?") {
        setActiveView("help");
        setQuery("");
        return;
      }

      // Escape returns to main view, clears scroll offset, or cancels active modal
      if (key.escape) {
        if (scrollOffset > 0) {
          setScrollOffset(0);
          setScrolledTurnId(null);
          return;
        }
        if (cancelActiveModal()) {
          return;
        }
        setActiveView("main");
        setPlanFormattedOutput(undefined);
        setQuery("");
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
    setScrollOffset(0);
    setScrolledTurnId(null);
    /* eslint-disable no-control-regex */
    let trimmed = value
      .replace(/\x1b?\[200~/g, "")
      .replace(/\x1b?\[201~/g, "")
      .replace(/\x1b?\[<\d+;\d+;\d+[Mm]/g, "")
      .replace(/\x1b/g, "")
      .trim();
    /* eslint-enable no-control-regex */

    if (
      commandSuggestions.length > 0 &&
      trimmed.startsWith("/") &&
      !trimmed.includes(" ") &&
      !commandSuggestions.some((c) => c.command === trimmed)
    ) {
      const clamped = Math.max(
        0,
        Math.min(selectedSuggestion, commandSuggestions.length - 1)
      );
      const selected = commandSuggestions[clamped];
      if (selected) {
        trimmed = selected.command;
      }
    }
    setSelectedSuggestion(0);

    if (trimmed && !trimmed.startsWith("/")) {
      setPromptHistory((prev) => {
        const filtered = prev.filter((p) => p !== trimmed);
        return [...filtered, trimmed];
      });
      setHistoryIndex(-1);
      draftPromptRef.current = "";
    }

    // Queue the prompt if agent is currently running and no modal is active
    const modalActive =
      Boolean(pendingApproval) ||
      Boolean(pendingPlanBlocked) ||
      Boolean(pendingRecovery) ||
      Boolean(pendingRecoveryContinuation) ||
      Boolean(pendingReplan) ||
      Boolean(pendingResume);

    if (!trimmed && !modalActive) return;

    // Apply safe defaults for modals when user hits Enter with empty input
    if (!trimmed && modalActive) {
      if (pendingPlanBlocked) {
        trimmed = "x";
      } else {
        trimmed = "n";
      }
    }

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
      if (
        choice === "y" ||
        choice === "yes" ||
        choice === "c" ||
        choice === "continue"
      ) {
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
      if (
        choice === "y" ||
        choice === "yes" ||
        choice === "p" ||
        choice === "proceed"
      ) {
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
      setBlockedInput("");
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
      setReplanInput("");
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
      setResumeInput("");
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
      const [rawCmd, ...rawArgs] = trimmed.split(/\s+/);
      const cmd = (rawCmd ?? "").toLowerCase();
      const arg = rawArgs.join(" ").trim();

      if (cmd === "/help") {
        setActiveView("help");
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
        await handleExit();
        return;
      }

      if (cmd === "/history") {
        const pageNum = arg ? parseInt(arg, 10) : 1;
        const validPage = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1;
        const historyText = SessionHistoryFormatter.formatHistory(
          completedSummaries,
          { limit: 10, page: validPage }
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
        const pageNum = arg ? parseInt(arg, 10) : 1;
        const validPage = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1;
        const tasksText = SessionHistoryFormatter.formatTaskList(
          completedSummaries,
          { limit: 10, page: validPage }
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
          setGitFormattedOutput(formatted);
          setActiveView("git");
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setGitFormattedOutput(`✗ Git error: ${msg}\n`);
          setActiveView("git");
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

        setDiagnosticsSummary(summary);
        setActiveView("diagnostics");
        return;
      }

      if (cmd === "/runs") {
        let runs: import("@fecode/agent").DurableRunRecord[] = [];
        const isAll =
          arg.toLowerCase().startsWith("--all") ||
          arg.toLowerCase().startsWith("-a") ||
          arg.toLowerCase() === "all";
        const limitArg = isAll
          ? arg.replace(/^--?all\s*|^--?a\s*|^all\s*/i, "").trim()
          : arg.trim();
        const parsedLimit =
          limitArg && /^\d+$/.test(limitArg) ? parseInt(limitArg, 10) : undefined;

        setRunsIsAll(isAll);
        const pid = await getProjectIdentifier(cwd, gitRepo);
        setCurrentProjectId(pid);

        if (agent && "listHistoricalRuns" in agent) {
          runs = await (
            agent as {
              listHistoricalRuns: (options?: {
                projectId?: string;
                limit?: number;
                allProjects?: boolean;
              }) => Promise<import("@fecode/agent").DurableRunRecord[]>;
            }
          ).listHistoricalRuns({
            projectId: isAll ? undefined : pid,
            limit: parsedLimit,
            allProjects: isAll
          });
        } else if (runtime && runtime.getHistoricalRuns) {
          runs = await runtime.getHistoricalRuns({
            projectId: isAll ? undefined : pid,
            limit: parsedLimit,
            allProjects: isAll
          });
        }

        setHistoricalRuns(
          runs.map((r) => ({
            runId: r.runId,
            status: r.finalStatus || r.executionState || "unknown",
            userRequestSummary: r.userRequestSummary,
            durationMs: r.durationMs,
            startedAt: r.startedAt,
            projectId: r.projectId
          }))
        );
        setActiveView("runs");
        return;
      }

      if (cmd === "/run") {
        setActiveView("main");
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
          const pageNum = arg ? parseInt(arg, 10) : 1;
          const validPage = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1;
          const formatted = SessionHistoryFormatter.formatSessionsList(list, {
            limit: 10,
            page: validPage
          });
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
            setPlanFormattedOutput(lines.join("\n") + "\n");
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
          setPlanFormattedOutput(detail);
        } else {
          setPlanFormattedOutput("No active plan found.\n");
        }
        return;
      }

      if (cmd === "/clear") {
        setTurns([]);
        setQuery("");
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
    setActiveView("main");
    setPlanFormattedOutput(undefined);
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
    const turnStartMs = Date.now();
    setExecutionStartTime(turnStartMs);
    const newTurn: Turn = {
      id: turnId,
      prompt: trimmed,
      response: initialResponse,
      status: "streaming"
    };
    setTurns((prev) => [...prev, newTurn]);

    let flushTextUpdates = (_force = false) => {};

    try {
      if (!agent) {
        throw new Error(configError || "Agent runtime is not initialized.");
      }

      const stream = agent.run({
        message: trimmed,
        cwd,
        sessionId
      });

      let accumulatedRawText = "";
      const toolCallMap = new Map<string, string>();
      let pendingTextChunk = "";
      let lastRenderMs = 0;
      const THROTTLE_MS = isTestEnv ? 0 : 50;

      flushTextUpdates = () => {
        if (!pendingTextChunk) return;
        const chunkToFlush = pendingTextChunk;
        pendingTextChunk = "";
        lastRenderMs = Date.now();
        const elapsed = Date.now() - turnStartMs;

        const thinkingMatch = accumulatedRawText.match(
          /<(?:think|thinking)>([\s\S]*?)<\/(?:think|thinking)>/
        );
        const inProgressThinking =
          !thinkingMatch &&
          (accumulatedRawText.includes("<think>") ||
            accumulatedRawText.includes("<thinking>") ||
            accumulatedRawText.startsWith("<think"));

        if (thinkingMatch) {
          setIsThinking(false);
          const thinkingContent = thinkingMatch[1].trim();
          const firstLine = thinkingContent.split("\n")[0]?.trim() || "";
          const cleanContent = accumulatedRawText
            .replace(/<(?:think|thinking)>[\s\S]*?<\/(?:think|thinking)>/g, "")
            .replace(/<\/?(?:think|thinking)>/g, "")
            .replace(/^\n+/, "");
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    status:
                      t.status === "error" ||
                      t.status === "done" ||
                      t.status === "cancelled"
                        ? t.status
                        : "streaming",
                    error: t.error,
                    thinkingMs:
                      t.thinkingMs !== undefined
                        ? t.thinkingMs
                        : elapsed > 0
                          ? elapsed
                          : 1000,
                    thinkingSummary: t.thinkingSummary || firstLine,
                    response: initialResponse
                      ? initialResponse + cleanContent
                      : cleanContent
                  }
                : t
            )
          );
        } else if (inProgressThinking) {
          setIsThinking(true);
          setTurns((prev) => {
            const turn = prev.find((t) => t.id === turnId);
            if (turn && turn.status !== "thinking") {
              return prev.map((t) =>
                t.id === turnId ? { ...t, status: "thinking" } : t
              );
            }
            return prev;
          });
        } else {
          setIsThinking(false);
          setTurns((prev) => {
            const turn = prev.find((t) => t.id === turnId);
            const isFirstToken =
              !turn?.response || turn.response === initialResponse;
            const sanitizedChunk = chunkToFlush.replace(
              /<\/?(?:think|thinking)>/g,
              ""
            );
            return prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    status:
                      t.status === "error" ||
                      t.status === "done" ||
                      t.status === "cancelled"
                        ? t.status
                        : "streaming",
                    error: t.error,
                    thinkingMs:
                      t.thinkingMs !== undefined
                        ? t.thinkingMs
                        : isFirstToken && elapsed > 500
                          ? elapsed
                          : undefined,
                    response: t.response + sanitizedChunk
                  }
                : t
            );
          });
        }
      };

      for await (const event of stream) {
        setUiState((prev) =>
          reduceUIState(
            prev ||
              createInitialUIState({
                cwd,
                sessionId
              }),
            event
          )
        );

        if (event.type !== "text") {
          if (
            event.type === "provider_fallback_attempt" &&
            event.partialTextInterrupted
          ) {
            pendingTextChunk = "";
            accumulatedRawText = "";
          } else {
            flushTextUpdates(true);
          }
        }

        if (event.type === "text") {
          const chunk = event.content;
          accumulatedRawText += chunk;
          pendingTextChunk += chunk;

          const hasThinkingTagChange =
            chunk.includes("<think") ||
            chunk.includes("</think") ||
            chunk.includes("<thinking") ||
            chunk.includes("</thinking>");

          const now = Date.now();
          if (
            THROTTLE_MS === 0 ||
            hasThinkingTagChange ||
            now - lastRenderMs >= THROTTLE_MS
          ) {
            flushTextUpdates(true);
          }
        } else if (event.type === "skills_activated") {
          if (event.skills && event.skills.length > 0) {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === turnId
                  ? {
                      ...t,
                      response:
                        t.response +
                        `⚡ Skills: ${event.skills.join(", ")}\n`
                    }
                  : t
              )
            );
          }
        } else if (event.type === "provider_fallback_attempt") {
          const notice = event.partialTextInterrupted
            ? `⟳ [Interrupted] Quota reached on ${event.fromProvider}. Restarting response with ${event.toProvider}...`
            : `⟳ Quota reached on ${event.fromProvider}. Falling back to ${event.toProvider}...`;
          setTurns((prev) =>
            prev.map((t) => {
              if (t.id !== turnId) return t;
              let baseResponse = t.response;
              if (event.partialTextInterrupted) {
                // Keep any skill header lines, discard uncommitted partial text tokens
                const skillLines = baseResponse
                  .split("\n")
                  .filter((line) => line.startsWith("⚡ Skills:"))
                  .join("\n");
                baseResponse = skillLines ? skillLines + "\n" : "";
              }
              const prefix = baseResponse
                ? baseResponse + (baseResponse.endsWith("\n") ? "" : "\n")
                : "";
              return {
                ...t,
                response: `${prefix}\n${notice}\n`
              };
            })
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
        } else if (event.type === "tool_call") {
          toolCallMap.set(event.call.id, event.call.name);
        } else if (event.type === "tool_result") {
          const toolName = toolCallMap.get(event.callId) || "tool";
          if (event.result.success) {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === turnId
                  ? {
                      ...t,
                      response: t.response.includes(`✓ ${toolName}`)
                        ? t.response
                        : t.response + `✓ ${toolName} executed\n`
                    }
                  : t
              )
            );
          } else if (event.result.error) {
            const errCode = event.result.error.code;
            let recoveryMsg = "";
            if (errCode === "NOT_FOUND") {
              recoveryMsg = `⚠ ${toolName}: File not found — searching again\n`;
            } else if (errCode === "EDIT_CONFLICT") {
              recoveryMsg = `⚠ ${toolName}: Edit conflict — refreshing file context\n`;
            } else if (errCode === "REPEATED_CALL_LOOP") {
              recoveryMsg = `⚠ ${toolName}: Repeated call loop detected — adapting strategy\n`;
            } else if (errCode === "COMMAND_TIMEOUT") {
              recoveryMsg = `⚠ ${toolName}: Command timed out\n`;
            } else {
              recoveryMsg = `✗ ${toolName}: ${event.result.error.message || "Execution error"}\n`;
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
        } else if (event.type === "plan_step_failed") {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    response:
                      t.response +
                      `✗ Step ${event.stepId} failed${event.error ? `: ${event.error}` : ""}\n`
                  }
                : t
            )
          );
        } else if (event.type === "plan_execution_failed") {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    status: "error",
                    error: event.reason,
                    response:
                      t.response +
                      `\n✗ Plan execution failed: ${event.reason || "Unknown error"}\n`
                  }
                : t
            )
          );
          setLastTaskStatus("blocked");
        } else if (event.type === "plan_execution_cancelled") {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    status: "cancelled",
                    response:
                      t.response +
                      `\n⊘ Plan execution cancelled: ${event.reason || "Cancelled by user"}\n`
                  }
                : t
            )
          );
          setLastTaskStatus("cancelled");
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
              t.id === turnId
                ? {
                    ...t,
                    status: "done",
                    response:
                      t.response && t.response.trim().length > 0
                        ? t.response
                        : "Completed (no output returned by the model)."
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
          t.id === turnId
            ? { ...t, status: "error", error: `✗ ${msg}` }
            : t
        )
      );
      setLastTaskStatus("blocked");
    } finally {
      flushTextUpdates(true);
      setIsGenerating(false);
      setIsThinking(false);
      setExecutionStartTime(undefined);
      setActiveElapsedMs(undefined);
      setActiveRequest(undefined);
    }
  };

  let activeStep: number | undefined;
  let totalSteps: number | undefined;
  let activeStepTitle: string | undefined;

  let activePlan = uiState?.activePlan;
  if (!activePlan && agent && "getTaskPlan" in agent && typeof (agent as { getTaskPlan?: () => unknown }).getTaskPlan === "function") {
    const rawPlan = (agent as { getTaskPlan: () => import("@fecode/agent").TaskPlan | undefined }).getTaskPlan();
    if (rawPlan) {
      activePlan = {
        planId: rawPlan.planId,
        runId: rawPlan.runId,
        objective: rawPlan.objective,
        userRequestSummary: rawPlan.userRequestSummary,
        status: rawPlan.status,
        steps: rawPlan.steps as unknown as import("@fecode/agent").StepSnapshot[],
        createdAt: rawPlan.createdAt,
        completedStepsCount: rawPlan.steps ? rawPlan.steps.filter((s) => s.status === "completed").length : 0,
        totalStepsCount: rawPlan.steps ? rawPlan.steps.length : 0
      };
    }
  }

  if (activePlan && activePlan.status !== "completed" && activePlan.steps && activePlan.steps.length > 0) {
    totalSteps = activePlan.totalStepsCount || activePlan.steps.length;
    let currentStep = uiState?.activeStepId
      ? activePlan.steps.find((s) => s.stepId === uiState.activeStepId)
      : undefined;

    if (!currentStep) {
      currentStep =
        activePlan.steps.find((s) => s.status === "in_progress") ||
        activePlan.steps.find(
          (s) => s.status !== "completed" && s.status !== "skipped"
        );
    }

    if (currentStep) {
      const idx = activePlan.steps.findIndex((s) => s.stepId === currentStep!.stepId);
      activeStep = currentStep.order || (idx >= 0 ? idx + 1 : 1);
      activeStepTitle = currentStep.title;
    }
  }

  return (
    <AppShell
      header={
        <Header
          projectName="fecode"
          providerName={providerName}
          modelName={modelName}
          cwd={cwd}
          status={uiState?.status || lastTaskStatus}
          gitBranch={uiState?.workspace?.gitBranch}
          isGitClean={uiState?.workspace ? !uiState.workspace.isGitDirty : true}
          runId={uiState?.runId}
          sessionId={sessionId}
          elapsedMs={activeElapsedMs}
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
                isScrolled={scrollOffset > 0}
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
          hasModal={hasModal}
          isScrolled={scrollOffset > 0}
          activeStep={activeStep}
          totalSteps={totalSteps}
          activeStepTitle={activeStepTitle}
          activeView={activeView}
          isReconciliation={Boolean(pendingPlanBlocked?.reconciliationResult)}
          recoveryMode={
            pendingRecoveryContinuation
              ? "continuation"
              : pendingRecovery
                ? "confirm"
                : undefined
          }
          modalType={
            pendingApproval
              ? "approval"
              : pendingPlanBlocked
                ? "blocked"
                : pendingRecovery || pendingRecoveryContinuation
                  ? "recovery"
                  : pendingReplan
                    ? "replan"
                    : pendingResume
                      ? "resume"
                      : undefined
          }
        />
      }
    >
      {/* Configuration Error Banner */}
      {configError && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="red"
          paddingX={1}
          marginY={1}
        >
          <Text bold color="red">
            ⚠ Configuration Error
          </Text>
          <Text color="white">{configError}</Text>
          <Text color="gray">
            Please check your environment variables (.env) or configuration file.
          </Text>
        </Box>
      )}

      {/* Content Area */}
      {activeView === "help" && <HelpView />}

      {activeView === "git" && (
        <WorkspaceStatus
          cwd={cwd}
          branch={uiState?.workspace?.gitBranch}
          isClean={uiState?.workspace ? !uiState.workspace.isGitDirty : true}
          riskLevel={uiState?.riskLevel}
          modifiedFiles={uiState?.workspace?.modifiedFiles}
          stagedFiles={uiState?.workspace?.stagedFiles}
          untrackedFiles={uiState?.workspace?.untrackedFiles}
          hasDrift={uiState?.workspace?.hasDrift}
          driftReason={uiState?.workspace?.driftReason}
          formattedOutput={gitFormattedOutput}
        />
      )}

      {activeView === "runs" && (
        <RunHistoryView
          projectId={currentProjectId}
          isAll={runsIsAll}
          runs={
            historicalRuns.length > 0
              ? historicalRuns
              : uiState?.diagnostics
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
        <DiagnosticsView summary={diagnosticsSummary || uiState?.diagnostics} />
      )}

      {activeView === "plan" && (
        <PlanView
          planId={uiState?.activePlan?.planId}
          objective={uiState?.activePlan?.objective}
          summary={uiState?.activePlan?.userRequestSummary}
          status={uiState?.activePlan?.status}
          steps={uiState?.activePlan?.steps}
          completedCount={uiState?.activePlan?.completedStepsCount}
          totalCount={uiState?.activePlan?.totalStepsCount}
          formattedOutput={planFormattedOutput}
        />
      )}

      {/* Active step & tool execution view */}
      {isGenerating && uiState?.activeTool && (
        <CurrentStepView
          toolName={uiState.activeTool.toolName}
          target={uiState.activeTool.target}
          riskLevel={uiState.riskLevel}
        />
      )}

      {/* Main Turns / Streaming execution */}
      <Box flexDirection="column">
        {activeView === "main" && (!hasModal || scrollOffset > 0 || isTestEnv) && (
          <>
            {scrollOffset > 0 ? (
              <>
                <Box marginY={0}>
                  <Text color="cyan">
                    ▲ Scrolled to turn {(() => {
                      const idx = scrolledTurnId
                        ? turns.findIndex((t) => t.id === scrolledTurnId)
                        : turns.length - 1 - scrollOffset;
                      return (idx >= 0 ? idx : turns.length - 1 - scrollOffset) + 1;
                    })()} of {turns.length} [↑/↓ or PageUp/PageDown to scroll, Esc or type to return]
                  </Text>
                </Box>
                {(() => {
                  const targetTurn =
                    (scrolledTurnId ? turns.find((t) => t.id === scrolledTurnId) : null) ||
                    turns[turns.length - 1 - scrollOffset];
                  if (!targetTurn) return null;
                  let displayResponse = targetTurn.response;
                  if (!isTestEnv && displayResponse) {
                    const rLines = displayResponse.split("\n");
                    const pLinesCount = (targetTurn.prompt || "").split("\n").length;
                    const maxRespLines = Math.max(4, availableTurnRows - pLinesCount - 4);
                    if (rLines.length > maxRespLines) {
                      displayResponse = "… [Earlier lines truncated in compact view]\n" + rLines.slice(-maxRespLines).join("\n");
                    }
                  }
                  return (
                    <TurnView
                      key={targetTurn.id}
                      prompt={targetTurn.prompt}
                      response={displayResponse}
                      status={targetTurn.status}
                      error={targetTurn.error}
                      isLast={false}
                      thinkingMs={targetTurn.thinkingMs}
                      thinkingTokens={targetTurn.thinkingTokens}
                      thinkingSummary={targetTurn.thinkingSummary}
                    />
                  );
                })()}
                <Box marginY={0}>
                  <Text color="yellow">
                    ▼ Scrolled up — [↓ / PageDown to return to live view] {isGenerating ? "(Agent running in background...)" : ""}
                  </Text>
                </Box>
              </>
            ) : (
              <>
                {hiddenTurnsCount > 0 && (
                  <Box marginY={0}>
                    <Text color="gray" dimColor>
                      ▲ {hiddenTurnsCount} earlier turn(s) [↑ / PageUp to scroll]
                    </Text>
                  </Box>
                )}
                {visibleTurns.map((turn, idx) => (
                  <TurnView
                    key={turn.id}
                    prompt={turn.prompt}
                    response={turn.response}
                    status={turn.status}
                    error={turn.error}
                    isLast={idx === visibleTurns.length - 1}
                    thinkingMs={turn.thinkingMs}
                    thinkingTokens={turn.thinkingTokens}
                    thinkingSummary={turn.thinkingSummary}
                  />
                ))}

                {/* Thinking Indicator — shown while generating */}
                {isGenerating && (
                  <Box marginTop={0}>
                    <ThinkingIndicator
                      isActive={isGenerating}
                      isScrolled={scrollOffset > 0}
                      label={isThinking ? "Thinking..." : "Agent is working..."}
                    />
                  </Box>
                )}
              </>
            )}
          </>
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
