import { describe, it, expect } from "vitest";
import { assessRisk } from "./riskAssessment.js";

describe("RiskAssessment — Phase 5G", () => {
  it("marks a simple single-file small task as not risky", () => {
    const res = assessRisk({
      request: "Fix typo in Header",
      expectedFilesCount: 1,
      expectedLinesCount: 5,
      modifiedFilePaths: ["src/Header.tsx"]
    });

    expect(res.risky).toBe(false);
    expect(res.reasons).toEqual([]);
  });

  it("marks multi-file tasks exceeding threshold as risky", () => {
    const res = assessRisk({
      request: "Update form components",
      expectedFilesCount: 5,
      modifiedFilePaths: [
        "src/Input.tsx",
        "src/Select.tsx",
        "src/Checkbox.tsx",
        "src/Radio.tsx",
        "src/Form.tsx"
      ]
    });

    expect(res.risky).toBe(true);
    expect(res.reasons).toContain("5 files may be modified");
  });

  it("marks large diffs as risky", () => {
    const res = assessRisk({
      request: "Refactor utilities",
      expectedFilesCount: 1,
      expectedLinesCount: 150,
      modifiedFilePaths: ["src/utils.ts"]
    });

    expect(res.risky).toBe(true);
    expect(res.reasons[0]).toContain("Large change proposed");
  });

  it("marks package.json and lockfile changes as risky", () => {
    const res = assessRisk({
      request: "Install zod and date-fns",
      modifiedFilePaths: ["package.json", "package-lock.json"]
    });

    expect(res.risky).toBe(true);
    expect(res.reasons).toContain("package.json will change");
  });

  it("marks build and TypeScript configuration changes as risky", () => {
    const res = assessRisk({
      request: "Update build target",
      modifiedFilePaths: ["tsconfig.json", "vite.config.ts"]
    });

    expect(res.risky).toBe(true);
    expect(res.reasons.some((r) => r.includes("Configuration files will change"))).toBe(true);
  });

  it("marks repeated verification failures as risky", () => {
    const res = assessRisk({
      request: "Fix broken test",
      hasFailedVerification: true,
      verificationAttempts: 1,
      modifiedFilePaths: ["src/auth.ts"]
    });

    expect(res.risky).toBe(true);
    expect(res.reasons).toContain(
      "Previous verification attempt failed; retry mutation proposed"
    );
  });

  it("marks broad destructive requests as risky", () => {
    const res = assessRisk({
      request: "Delete all old components and rewrite entire navigation",
      modifiedFilePaths: ["src/Nav.tsx"]
    });

    expect(res.risky).toBe(true);
    expect(res.reasons).toContain("Broad or destructive changes requested");
  });

  it("respects custom configurable thresholds", () => {
    const res = assessRisk({
      expectedFilesCount: 2,
      expectedLinesCount: 30,
      modifiedFilePaths: ["src/a.ts", "src/b.ts"],
      thresholds: {
        maxSafeFiles: 1,
        maxSafeLines: 20
      }
    });

    expect(res.risky).toBe(true);
    expect(res.reasons).toContain("2 files may be modified");
    expect(res.reasons[1]).toContain("Large change proposed");
  });
});
