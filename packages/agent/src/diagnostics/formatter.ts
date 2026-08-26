import type { RunSummary } from "./types.js";

export function formatRunDiagnostics(summary: RunSummary): string {
  const lines: string[] = [];
  const durationSec =
    summary.durationMs !== undefined
      ? `${(summary.durationMs / 1000).toFixed(1)}s`
      : "in progress";

  lines.push(`Run: ${summary.runId}`);
  lines.push(`Status: ${summary.finalStatus}`);
  lines.push(`Duration: ${durationSec}`);

  if (summary.failureReason || summary.failureCode) {
    lines.push(
      `Failure: [${summary.failureCode || "FAILED"}] ${summary.failureReason || "Unknown failure"}`
    );
  }
  if (summary.cancellationReason) {
    lines.push(`Cancellation: ${summary.cancellationReason}`);
  }

  if (summary.planId) {
    lines.push("");
    lines.push(
      `Plan: ${summary.planId} [${(summary.planStatus || "ready").toUpperCase()}]`
    );
    if (summary.planSummary) {
      lines.push(`  Objective: ${summary.planSummary}`);
    }
    if (summary.totalPlanSteps !== undefined) {
      let stepsStr = `  Steps:     ${summary.completedPlanSteps ?? 0}/${summary.totalPlanSteps} completed`;
      if (summary.skippedPlanSteps) {
        stepsStr += ` (${summary.skippedPlanSteps} skipped)`;
      }
      lines.push(stepsStr);
    }
    if (summary.failedPlanStep) {
      lines.push(`  Failed:    ${summary.failedPlanStep}`);
    }
    if (summary.planExecutionDurationMs !== undefined) {
      lines.push(
        `  Execution: ${(summary.planExecutionDurationMs / 1000).toFixed(1)}s`
      );
    }
    if (summary.parentPlanId) {
      lines.push(`  Parent:    ${summary.parentPlanId} (depth ${summary.replanDepth ?? 0})`);
    }
    if (summary.replanReason) {
      lines.push(`  Reason:    ${summary.replanReason}`);
    }
    if (summary.replanCount) {
      lines.push(`  Replans:   ${summary.replanCount}`);
    }
    if (summary.feedbackCount) {
      let fbStr = `  Feedback:  ${summary.feedbackCount} recorded`;
      if (summary.blockingFeedbackCount) {
        fbStr += ` (${summary.blockingFeedbackCount} blocking)`;
      }
      lines.push(fbStr);
    }
    if (summary.retryCount) {
      lines.push(`  Retries:   ${summary.retryCount}`);
    }
    if (summary.blockedPlanSteps && summary.blockedPlanSteps.length > 0) {
      lines.push(`  Blocked:   ${summary.blockedPlanSteps.join(", ")}`);
    }
    if (summary.planAdaptationReasons && summary.planAdaptationReasons.length > 0) {
      lines.push(`  Adaptations: ${summary.planAdaptationReasons.join("; ")}`);
    }
    if (summary.executionDecision) {
      let decStr = `  Decision:  ${summary.executionDecision.toUpperCase()}`;
      if (summary.decisionOutcome) {
        decStr += ` (${summary.decisionOutcome})`;
      }
      lines.push(decStr);
    }
    if (summary.resumedFromStepId) {
      lines.push(`  Resumed:   step ${summary.resumedFromStepId} (order ${summary.resumedStepOrder ?? 1})`);
    }
  }

  if (summary.lifecycleTransitions.length > 0) {
    lines.push("");
    lines.push("Lifecycle:");
    for (const t of summary.lifecycleTransitions) {
      lines.push(`  ${t.from} -> ${t.to} (${t.reason})`);
    }
  }

  if (summary.tools.length > 0) {
    lines.push("");
    lines.push("Tools:");
    for (const t of summary.tools) {
      const mark = t.success === true ? "✓" : t.success === false ? "✗" : "●";
      const dur = t.durationMs !== undefined ? ` (${t.durationMs}ms)` : "";
      const err = t.errorCode ? ` [${t.errorCode}]` : "";
      lines.push(`  ${t.toolName.padEnd(16)} ${mark}${dur}${err}`);
    }
  }

  if (summary.commands.length > 0) {
    lines.push("");
    lines.push("Verification Commands:");
    for (const c of summary.commands) {
      const mark = c.succeeded ? "✓" : "✗";
      const dur = c.durationMs !== undefined ? ` (${c.durationMs}ms)` : "";
      const exitStr = c.exitCode !== undefined ? ` (exit ${c.exitCode})` : "";
      lines.push(
        `  attempt ${c.attempt}: ${c.command}${exitStr} ${mark}${dur}`
      );
    }
  }

  if (summary.recovery && summary.recovery.length > 0) {
    lines.push("");
    lines.push("Recovery Operations:");
    for (const r of summary.recovery) {
      const mark = r.success ? "✓" : "✗";
      const dur = r.durationMs !== undefined ? ` (${r.durationMs}ms)` : "";
      lines.push(
        `  attempt ${r.attempt}: Checkpoint ${r.checkpointId} ${mark}${dur}`
      );
    }
  }

  if (summary.activeSkills.length > 0) {
    lines.push("");
    lines.push("Skills:");
    for (const s of summary.activeSkills) {
      lines.push(`  ${s}`);
    }
  }

  lines.push("");
  lines.push("Risk:");
  lines.push(`  level: ${summary.initialRiskLevel}`);
  if (summary.riskReasons.length > 0) {
    for (const r of summary.riskReasons) {
      lines.push(`  - ${r}`);
    }
  }
  if (summary.checkpointId) {
    lines.push(`  checkpoint: ${summary.checkpointId}`);
  }

  const allFiles = [
    ...summary.files.modified.map((f) => `  modified: ${f}`),
    ...summary.files.created.map((f) => `  created:  ${f}`),
    ...summary.files.deleted.map((f) => `  deleted:  ${f}`)
  ];
  if (allFiles.length > 0) {
    lines.push("");
    lines.push("Files:");
    for (const f of allFiles) {
      lines.push(f);
    }
  }

  if (summary.reconciliationStatus) {
    lines.push("");
    lines.push("Final Reconciliation:");
    lines.push(`  status:     ${summary.reconciliationStatus}`);
    if (summary.reconciliationConsistent !== undefined) {
      lines.push(`  consistent: ${summary.reconciliationConsistent ? "yes" : "no"}`);
    }
    if (summary.expectedFileCount !== undefined) {
      lines.push(`  expected:   ${summary.expectedFileCount} files`);
    }
    if (summary.missingFileCount !== undefined && summary.missingFileCount > 0) {
      lines.push(`  missing:    ${summary.missingFileCount} files`);
    }
    if (summary.unexpectedFileCount !== undefined && summary.unexpectedFileCount > 0) {
      lines.push(`  unexpected: ${summary.unexpectedFileCount} files`);
    }
    if (summary.reconciliationFailureReason) {
      lines.push(`  reason:     ${summary.reconciliationFailureReason}`);
    }
  }

  if (summary.executionRecoveryCount !== undefined && summary.executionRecoveryCount > 0) {
    lines.push("");
    lines.push("Execution Recovery:");
    lines.push(`  attempts:   ${summary.executionRecoveryCount}`);
    if (summary.lastRecoveryStrategy) {
      lines.push(`  strategy:   ${summary.lastRecoveryStrategy}`);
    }
    if (summary.lastRecoveryOutcome) {
      lines.push(`  outcome:    ${summary.lastRecoveryOutcome.toUpperCase()}`);
    } else if (summary.lastRecoveryStatus) {
      lines.push(`  status:     ${summary.lastRecoveryStatus}`);
    }
    if (summary.lastRecoveryWorkspaceConsistent !== undefined) {
      lines.push(`  consistent: ${summary.lastRecoveryWorkspaceConsistent ? "yes" : "no"}`);
    }
    if (summary.lastRecoveryDurationMs !== undefined) {
      lines.push(`  duration:   ${summary.lastRecoveryDurationMs}ms`);
    }
    if (summary.repairedFiles && summary.repairedFiles.length > 0) {
      lines.push(`  repaired:   ${summary.repairedFiles.join(", ")}`);
    }
    if (
      summary.lastRecoveryBlockingReasons &&
      summary.lastRecoveryBlockingReasons.length > 0
    ) {
      lines.push("  blockers:");
      summary.lastRecoveryBlockingReasons.forEach((b) => lines.push(`    • ${b}`));
    } else if (summary.recoveryFailureReason) {
      lines.push(`  reason:     ${summary.recoveryFailureReason}`);
    }
  }

  if (summary.continuationCount !== undefined && summary.continuationCount > 0) {
    lines.push("");
    lines.push("Recovery Continuation:");
    lines.push(`  attempts:   ${summary.continuationCount}`);
    if (summary.lastContinuationDecision) {
      lines.push(`  decision:   ${summary.lastContinuationDecision}`);
    }
    if (summary.lastContinuationStatus) {
      lines.push(`  status:     ${summary.lastContinuationStatus}`);
    }
    if (summary.lastContinuationDurationMs !== undefined) {
      lines.push(`  duration:   ${summary.lastContinuationDurationMs}ms`);
    }
    if (
      summary.lastContinuationResumedSteps &&
      summary.lastContinuationResumedSteps.length > 0
    ) {
      lines.push(
        `  resumed:    ${summary.lastContinuationResumedSteps.join(", ")}`
      );
    }
    if (
      summary.lastContinuationBlockingReasons &&
      summary.lastContinuationBlockingReasons.length > 0
    ) {
      lines.push("  blockers:");
      summary.lastContinuationBlockingReasons.forEach((b) =>
        lines.push(`    • ${b}`)
      );
    } else if (summary.continuationFailureReason) {
      lines.push(`  reason:     ${summary.continuationFailureReason}`);
    }
  }

  return lines.join("\n");
}
