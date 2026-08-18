import type { RiskAssessment, RiskAssessmentOptions } from "./types.js";
import * as path from "path";

const CONFIG_FILES = new Set([
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "tsconfig.json",
  "tsconfig.node.json",
  "vite.config.ts",
  "vite.config.js",
  "next.config.js",
  "next.config.mjs",
  "webpack.config.js",
  ".eslintrc.json",
  ".eslintrc.js",
  "eslint.config.js",
  "eslint.config.mjs"
]);

export function assessRisk(options: RiskAssessmentOptions): RiskAssessment {
  const reasons: string[] = [];

  const maxSafeFiles = options.thresholds?.maxSafeFiles ?? 3;
  const maxSafeLines = options.thresholds?.maxSafeLines ?? 100;

  // 1. Expected / modified files count
  const fileCount =
    options.expectedFilesCount ??
    (options.modifiedFilePaths ? options.modifiedFilePaths.length : 0);
  if (fileCount > maxSafeFiles) {
    reasons.push(`${fileCount} files may be modified`);
  }

  // 2. Expected lines count
  if (
    options.expectedLinesCount !== undefined &&
    options.expectedLinesCount > maxSafeLines
  ) {
    reasons.push(
      `Large change proposed (+/- ${options.expectedLinesCount} lines)`
    );
  }

  // 3. Configuration & package files
  if (options.modifiedFilePaths && options.modifiedFilePaths.length > 0) {
    const affectedConfigs: string[] = [];
    for (const p of options.modifiedFilePaths) {
      const base = path.basename(p.replace(/\\/g, "/"));
      if (CONFIG_FILES.has(base) || base.startsWith("tsconfig.") || base.startsWith("vite.config.")) {
        affectedConfigs.push(base);
      }
    }
    if (affectedConfigs.length > 0) {
      const uniqueConfigs = Array.from(new Set(affectedConfigs));
      if (uniqueConfigs.includes("package.json")) {
        reasons.push("package.json will change");
      }
      const otherConfigs = uniqueConfigs.filter((c) => c !== "package.json");
      if (otherConfigs.length > 0) {
        reasons.push(`Configuration files will change (${otherConfigs.join(", ")})`);
      }
    }
  }

  // 4. Repeated verification / fix failures
  if (
    options.hasFailedVerification ||
    (options.verificationAttempts !== undefined &&
      options.verificationAttempts > 0)
  ) {
    reasons.push("Previous verification attempt failed; retry mutation proposed");
  }

  // 5. Broad / destructive keywords in user request
  if (options.request) {
    const lower = options.request.toLowerCase();
    if (
      lower.includes("delete all") ||
      lower.includes("rewrite entire") ||
      lower.includes("refactor all") ||
      lower.includes("migrate whole") ||
      lower.includes("drop database") ||
      lower.includes("clean install")
    ) {
      reasons.push("Broad or destructive changes requested");
    }
  }

  return {
    risky: reasons.length > 0,
    reasons
  };
}
