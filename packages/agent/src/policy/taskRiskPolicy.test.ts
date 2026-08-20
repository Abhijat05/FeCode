import { describe, it, expect } from "vitest";
import { DefaultTaskRiskPolicy } from "./taskRiskPolicy.js";
import { TaskRiskFormatter } from "./formatter.js";
import type { TaskRiskContext } from "./types.js";

describe("Task Risk & Execution Policy — Phase 5I", () => {
  const policy = new DefaultTaskRiskPolicy();

  describe("Low Risk Classification", () => {
    it("classifies read-only tools with no affected files as low risk", () => {
      const context: TaskRiskContext = {
        userMessage: "List files in the directory",
        cwd: "/test",
        affectedFiles: [],
        operations: ["list_directory", "read_file", "search_files"]
      };

      const assessment = policy.assess(context);

      expect(assessment.level).toBe("low");
      expect(assessment.requiresCheckpoint).toBe(false);
      expect(assessment.requiresExplicitApproval).toBe(false);
      expect(assessment.affectedFiles).toBe(0);
    });

    it("classifies inspection query as low risk", () => {
      const context: TaskRiskContext = {
        userMessage: "What is the structure of this project?",
        cwd: "/test",
        affectedFiles: [],
        operations: []
      };

      const assessment = policy.assess(context);

      expect(assessment.level).toBe("low");
      expect(assessment.requiresCheckpoint).toBe(false);
      expect(assessment.requiresExplicitApproval).toBe(false);
    });
  });

  describe("Normal Risk Classification", () => {
    it("classifies single source file edit as normal risk", () => {
      const context: TaskRiskContext = {
        userMessage: "Fix the button padding",
        cwd: "/test",
        affectedFiles: ["src/components/Button.tsx"],
        operations: ["edit_file"]
      };

      const assessment = policy.assess(context);

      expect(assessment.level).toBe("normal");
      expect(assessment.requiresCheckpoint).toBe(false);
      expect(assessment.requiresExplicitApproval).toBe(false);
      expect(assessment.affectedFiles).toBe(1);
    });

    it("classifies up to 3 localized source file edits as normal risk", () => {
      const context: TaskRiskContext = {
        userMessage: "Update theme colors",
        cwd: "/test",
        affectedFiles: [
          "src/styles/theme.ts",
          "src/components/Header.tsx",
          "src/components/Footer.tsx"
        ],
        operations: ["edit_file"]
      };

      const assessment = policy.assess(context);

      expect(assessment.level).toBe("normal");
      expect(assessment.requiresCheckpoint).toBe(false);
      expect(assessment.requiresExplicitApproval).toBe(false);
      expect(assessment.affectedFiles).toBe(3);
    });
  });

  describe("Elevated Risk Classification", () => {
    it("classifies 4 or more modified files as elevated risk and requires checkpoint", () => {
      const context: TaskRiskContext = {
        userMessage: "Refactor user authentication components",
        cwd: "/test",
        affectedFiles: [
          "src/auth/login.tsx",
          "src/auth/signup.tsx",
          "src/auth/session.ts",
          "src/auth/types.ts"
        ],
        operations: ["edit_file"]
      };

      const assessment = policy.assess(context);

      expect(assessment.level).toBe("elevated");
      expect(assessment.requiresCheckpoint).toBe(true);
      expect(assessment.requiresExplicitApproval).toBe(false);
      expect(assessment.affectedFiles).toBe(4);
    });

    it("classifies large workspace modification (>10 files) as elevated risk", () => {
      const files = Array.from({ length: 12 }, (_, i) => `src/file${i}.ts`);
      const context: TaskRiskContext = {
        userMessage: "Mass rename imports",
        cwd: "/test",
        affectedFiles: files,
        operations: ["edit_file"]
      };

      const assessment = policy.assess(context);

      expect(assessment.level).toBe("elevated");
      expect(assessment.requiresCheckpoint).toBe(true);
      expect(assessment.reasons).toContain("Large workspace modification (12 files)");
    });

    it("classifies package.json modification as elevated risk", () => {
      const context: TaskRiskContext = {
        userMessage: "Add axios dependency",
        cwd: "/test",
        affectedFiles: ["package.json"],
        operations: ["edit_file"]
      };

      const assessment = policy.assess(context);

      expect(assessment.level).toBe("elevated");
      expect(assessment.requiresCheckpoint).toBe(true);
      expect(assessment.reasons.some((r) => r.includes("package.json"))).toBe(true);
    });

    it("classifies lockfile modification as elevated risk", () => {
      const context: TaskRiskContext = {
        userMessage: "Update lockfile",
        cwd: "/test",
        affectedFiles: ["pnpm-lock.yaml"],
        operations: ["edit_file"]
      };

      const assessment = policy.assess(context);

      expect(assessment.level).toBe("elevated");
      expect(assessment.requiresCheckpoint).toBe(true);
      expect(assessment.reasons.some((r) => r.includes("pnpm-lock.yaml"))).toBe(true);
    });

    it("classifies TypeScript and build configuration changes as elevated risk", () => {
      const context: TaskRiskContext = {
        userMessage: "Update build config",
        cwd: "/test",
        affectedFiles: ["tsconfig.json", "vite.config.ts"],
        operations: ["edit_file"]
      };

      const assessment = policy.assess(context);

      expect(assessment.level).toBe("elevated");
      expect(assessment.requiresCheckpoint).toBe(true);
      expect(assessment.reasons.some((r) => r.includes("tsconfig.json"))).toBe(true);
      expect(assessment.reasons.some((r) => r.includes("vite.config.ts"))).toBe(true);
    });

    it("classifies dependency keywords in user prompt as elevated risk", () => {
      const context: TaskRiskContext = {
        userMessage: "npm install lodash and configure it",
        cwd: "/test",
        affectedFiles: [],
        operations: []
      };

      const assessment = policy.assess(context);

      expect(assessment.level).toBe("elevated");
      expect(assessment.requiresCheckpoint).toBe(true);
      expect(assessment.reasons).toContain("Dependency or configuration changes requested");
    });
  });

  describe("Critical Risk Classification", () => {
    it("classifies file deletion as critical risk", () => {
      const context: TaskRiskContext = {
        userMessage: "Delete legacy service",
        cwd: "/test",
        affectedFiles: ["src/legacy/oldService.ts"],
        operations: ["delete_file"]
      };

      const assessment = policy.assess(context);

      expect(assessment.level).toBe("critical");
      expect(assessment.requiresCheckpoint).toBe(true);
      expect(assessment.requiresExplicitApproval).toBe(true);
      expect(assessment.reasons.some((r) => r.includes("Destructive operation"))).toBe(true);
    });

    it("classifies recovery operations as critical risk", () => {
      const context: TaskRiskContext = {
        userMessage: "Rollback to checkpoint-a1b2c3",
        cwd: "/test",
        affectedFiles: [],
        operations: ["recovery"]
      };

      const assessment = policy.assess(context);

      expect(assessment.level).toBe("critical");
      expect(assessment.requiresCheckpoint).toBe(true);
      expect(assessment.requiresExplicitApproval).toBe(true);
      expect(assessment.reasons).toContain("Recovery operation requested");
    });

    it("classifies protected/sensitive file operations as critical risk without reading file content", () => {
      const context: TaskRiskContext = {
        userMessage: "Update environment variables",
        cwd: "/test",
        affectedFiles: [".env", "credentials.json", "id_rsa"],
        operations: ["write_file"]
      };

      const assessment = policy.assess(context);

      expect(assessment.level).toBe("critical");
      expect(assessment.requiresCheckpoint).toBe(true);
      expect(assessment.requiresExplicitApproval).toBe(true);
      expect(assessment.reasons.some((r) => r.includes(".env"))).toBe(true);
      expect(assessment.reasons.some((r) => r.includes("id_rsa"))).toBe(true);
    });

    it("classifies destructive user message phrases as critical risk", () => {
      const context: TaskRiskContext = {
        userMessage: "delete all tests and rewrite entire codebase",
        cwd: "/test",
        affectedFiles: [],
        operations: []
      };

      const assessment = policy.assess(context);

      expect(assessment.level).toBe("critical");
      expect(assessment.requiresCheckpoint).toBe(true);
      expect(assessment.requiresExplicitApproval).toBe(true);
      expect(assessment.reasons).toContain("Broad or destructive changes requested in message");
    });
  });

  describe("Determinism & Monotonicity", () => {
    it("produces identical output for identical input", () => {
      const context: TaskRiskContext = {
        userMessage: "Refactor auth and modify package.json",
        cwd: "/test",
        affectedFiles: ["package.json", "src/auth.ts", "src/login.ts"],
        operations: ["edit_file"]
      };

      const assessment1 = policy.assess(context);
      const assessment2 = policy.assess(context);

      expect(assessment1).toEqual(assessment2);
    });

    it("enforces monotonicity: higher risk signals never get lowered by safer signals", () => {
      // Mixed: 1 read-only operation, 1 normal edit, 1 critical protected file
      const context: TaskRiskContext = {
        userMessage: "Read files and update .env",
        cwd: "/test",
        affectedFiles: [".env"],
        operations: ["read_file", "edit_file"]
      };

      const assessment = policy.assess(context);

      expect(assessment.level).toBe("critical");
      expect(assessment.requiresCheckpoint).toBe(true);
      expect(assessment.requiresExplicitApproval).toBe(true);
    });
  });

  describe("TaskRiskFormatter", () => {
    it("returns empty string for low and normal risk", () => {
      const low = policy.assess({
        userMessage: "Read readme",
        cwd: "/test",
        affectedFiles: [],
        operations: ["read_file"]
      });
      expect(TaskRiskFormatter.formatRiskNotice(low)).toBe("");

      const normal = policy.assess({
        userMessage: "Edit button",
        cwd: "/test",
        affectedFiles: ["src/Button.tsx"],
        operations: ["edit_file"]
      });
      expect(TaskRiskFormatter.formatRiskNotice(normal)).toBe("");
    });

    it("formats elevated risk notice", () => {
      const elevated = policy.assess({
        userMessage: "Update dependencies",
        cwd: "/test",
        affectedFiles: ["package.json", "pnpm-lock.yaml"],
        operations: ["edit_file"]
      });

      const notice = TaskRiskFormatter.formatRiskNotice(elevated);
      expect(notice).toContain("● Elevated-risk task");
      expect(notice).toContain("package.json");
      expect(notice).toContain("Checkpoint required");
    });

    it("formats critical risk notice with checkpoint and prompt", () => {
      const critical = policy.assess({
        userMessage: "Delete service",
        cwd: "/test",
        affectedFiles: [".env"],
        operations: ["delete"]
      });

      const notice = TaskRiskFormatter.formatRiskNotice(
        critical,
        "checkpoint-xyz123"
      );
      expect(notice).toContain("⚠ Critical operation");
      expect(notice).toContain("This operation may substantially modify repository state.");
      expect(notice).toContain(".env");
      expect(notice).toContain("Checkpoint: checkpoint-xyz123");
      expect(notice).toContain("Proceed? [y/N]");
    });
  });
});
