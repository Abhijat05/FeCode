import * as path from "path";
import type {
  ExecutionPolicy,
  TaskRiskAssessment,
  TaskRiskContext,
  TaskRiskLevel
} from "./types.js";
import { isSecretFile } from "../editing/validator.js";

const RISK_RANKS: Record<TaskRiskLevel, number> = {
  low: 1,
  normal: 2,
  elevated: 3,
  critical: 4
};

const CONFIG_FILE_PATTERNS = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "tsconfig.json",
  "tsconfig.node.json",
  "tsconfig.app.json",
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "webpack.config.js",
  "webpack.config.ts",
  "rollup.config.js",
  "rollup.config.ts",
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.ts",
  ".eslintrc.json",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.yaml",
  ".eslintrc.yml",
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.js",
  "babel.config.js",
  "babel.config.json",
  "jest.config.js",
  "jest.config.ts",
  "vitest.config.ts",
  "vitest.config.js"
];

const READ_ONLY_OPERATIONS = new Set([
  "read_file",
  "list_directory",
  "search_files",
  "read",
  "list",
  "search",
  "inspect"
]);

const DESTRUCTIVE_OPERATIONS = new Set([
  "delete",
  "delete_file",
  "remove",
  "drop",
  "truncate",
  "destroy",
  "purge",
  "wipe"
]);

const RECOVERY_OPERATIONS = new Set([
  "recovery",
  "restore",
  "rollback",
  "recover_checkpoint",
  "restore_checkpoint"
]);

function isConfigFile(filePath: string): boolean {
  const base = path.basename(filePath.replace(/\\/g, "/")).toLowerCase();
  if (CONFIG_FILE_PATTERNS.includes(base)) return true;
  if (
    base.startsWith("tsconfig.") ||
    base.startsWith("vite.config.") ||
    base.startsWith("next.config.") ||
    base.startsWith("webpack.config.") ||
    base.startsWith("eslint.config.") ||
    base.startsWith(".eslintrc") ||
    base.startsWith(".prettierrc")
  ) {
    return true;
  }
  return false;
}

export class DefaultTaskRiskPolicy implements ExecutionPolicy {
  public assess(context: TaskRiskContext): TaskRiskAssessment {
    let currentLevel: TaskRiskLevel = "low";
    const reasons: string[] = [];

    const elevate = (
      targetLevel: TaskRiskLevel,
      reason?: string
    ): TaskRiskLevel => {
      if (reason && !reasons.includes(reason)) {
        reasons.push(reason);
      }
      return RISK_RANKS[targetLevel] > RISK_RANKS[currentLevel]
        ? targetLevel
        : currentLevel;
    };

    const affectedCount = context.affectedFiles ? context.affectedFiles.length : 0;

    // 1. Evaluate Affected Files Count (Scope Escalation)
    if (affectedCount > 10) {
      currentLevel = elevate("elevated", `Large workspace modification (${affectedCount} files)`);
    } else if (affectedCount >= 4) {
      currentLevel = elevate("elevated", `${affectedCount} files may be modified`);
    } else if (affectedCount >= 1) {
      currentLevel = elevate("normal", `${affectedCount} file${affectedCount === 1 ? "" : "s"} modified`);
    }

    // 2. Evaluate Specific Files (Sensitive & Config)
    if (context.affectedFiles && context.affectedFiles.length > 0) {
      for (const file of context.affectedFiles) {
        const normalized = file.replace(/\\/g, "/");

        if (isSecretFile(normalized)) {
          currentLevel = elevate("critical", `Protected/sensitive file involved: ${path.basename(normalized)}`);
        } else if (isConfigFile(normalized)) {
          currentLevel = elevate("elevated", `Configuration or dependency file will change: ${path.basename(normalized)}`);
        }
      }
    }

    // 3. Evaluate Operations
    if (context.operations && context.operations.length > 0) {
      for (const op of context.operations) {
        const lowerOp = op.toLowerCase();
        if (RECOVERY_OPERATIONS.has(lowerOp)) {
          currentLevel = elevate("critical", "Recovery operation requested");
        } else if (DESTRUCTIVE_OPERATIONS.has(lowerOp)) {
          currentLevel = elevate("critical", `Destructive operation requested: ${op}`);
        } else if (lowerOp === "write_file" || lowerOp === "edit_file" || lowerOp === "write" || lowerOp === "edit") {
          currentLevel = elevate("normal");
        } else if (lowerOp === "execute_command" || lowerOp === "exec") {
          currentLevel = elevate("normal");
        } else if (READ_ONLY_OPERATIONS.has(lowerOp)) {
          // Read-only
        } else {
          currentLevel = elevate("normal");
        }
      }
    }

    // 4. Evaluate User Message Signals (Deterministic Keywords)
    if (context.userMessage) {
      const lowerMsg = context.userMessage.toLowerCase();

      // Check for recovery keywords
      if (
        lowerMsg.includes("recover checkpoint") ||
        lowerMsg.includes("restore checkpoint") ||
        lowerMsg.includes("rollback to checkpoint") ||
        lowerMsg.startsWith("/recover")
      ) {
        currentLevel = elevate("critical", "Recovery operation requested");
      }

      // Check for destructive keywords
      if (
        lowerMsg.includes("delete all") ||
        lowerMsg.includes("rewrite entire") ||
        lowerMsg.includes("refactor all") ||
        lowerMsg.includes("drop database") ||
        lowerMsg.includes("clean install") ||
        lowerMsg.includes("wipe repository") ||
        lowerMsg.includes("purge files")
      ) {
        currentLevel = elevate("critical", "Broad or destructive changes requested in message");
      }

      // Check for configuration/dependency keywords
      if (
        lowerMsg.includes("install package") ||
        lowerMsg.includes("add dependency") ||
        lowerMsg.includes("npm install") ||
        lowerMsg.includes("yarn add") ||
        lowerMsg.includes("pnpm add") ||
        lowerMsg.includes("update package.json") ||
        lowerMsg.includes("modify tsconfig")
      ) {
        currentLevel = elevate("elevated", "Dependency or configuration changes requested");
      }
    }

    // Baseline fallback reasons if none explicitly added
    if (reasons.length === 0) {
      if (currentLevel === "low") {
        reasons.push("Read-only inspection");
      } else if (currentLevel === "normal") {
        reasons.push("Standard localized source edit");
      }
    }

    const requiresCheckpoint = currentLevel === "elevated" || currentLevel === "critical";
    const requiresExplicitApproval = currentLevel === "critical";

    return {
      level: currentLevel,
      reasons,
      affectedFiles: affectedCount,
      requiresCheckpoint,
      requiresExplicitApproval
    };
  }
}
