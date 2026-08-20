import type { TaskRiskAssessment } from "./types.js";
import { sanitizeText } from "../session/sanitizer.js";

export class TaskRiskFormatter {
  public static formatRiskNotice(
    assessment: TaskRiskAssessment,
    checkpointId?: string
  ): string {
    if (assessment.level === "low" || assessment.level === "normal") {
      return "";
    }

    if (assessment.level === "elevated") {
      let text = "● Elevated-risk task\n";
      for (const r of assessment.reasons) {
        text += `  • ${sanitizeText(r)}\n`;
      }
      if (assessment.requiresCheckpoint) {
        text += "  Checkpoint required\n";
      }
      return text;
    }

    // Critical
    let text = "⚠ Critical operation\n\n";
    text += "This operation may substantially modify repository state.\n\n";
    if (assessment.reasons.length > 0) {
      text += "Reasons:\n";
      for (const r of assessment.reasons) {
        text += `  • ${sanitizeText(r)}\n`;
      }
      text += "\n";
    }

    if (checkpointId) {
      text += `Checkpoint: ${checkpointId}\n\n`;
    }

    text += "Proceed? [y/N]";
    return text;
  }
}
