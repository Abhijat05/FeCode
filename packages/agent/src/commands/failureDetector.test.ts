import { describe, it, expect } from "vitest";
import { detectMaskedCommandFailure } from "./failureDetector.js";

describe("detectMaskedCommandFailure", () => {
  it("returns hasMaskedFailure=false for normal successful test outputs", () => {
    const stdout = `
 RUN  v4.1.11 D:/repo
 ✓ src/App.test.ts (10 tests) 15ms
 Test Files  1 passed (1)
      Tests  10 passed (10)
   Duration  120ms
`;
    const res = detectMaskedCommandFailure("npm test", stdout, "");
    expect(res.hasMaskedFailure).toBe(false);
  });

  it("returns hasMaskedFailure=false when 0 failed is reported", () => {
    const stdout = "Tests: 15 passed, 0 failed, 15 total";
    const res = detectMaskedCommandFailure("npm test", stdout, "");
    expect(res.hasMaskedFailure).toBe(false);
  });

  it("detects Jest/Vitest FAIL test file status line", () => {
    const stdout = `
 FAIL  packages/agent/src/index.test.ts
  ✕ should process correctly
`;
    const res = detectMaskedCommandFailure("npm test", stdout, "");
    expect(res.hasMaskedFailure).toBe(true);
    expect(res.reason).toContain("Test file failure reported");
  });

  it("detects Jest/Vitest test runner summary with failing tests", () => {
    const stdout = "Tests:       1 failed, 12 passed, 13 total";
    const res = detectMaskedCommandFailure("npm test", stdout, "");
    expect(res.hasMaskedFailure).toBe(true);
    expect(res.reason).toContain("Test runner summary");
  });

  it("detects AssertionError during test or script execution", () => {
    const stdout = "AssertionError [ERR_ASSERTION]: Expected 42 but got 0";
    const res = detectMaskedCommandFailure("node test.js", stdout, "");
    expect(res.hasMaskedFailure).toBe(true);
    expect(res.reason).toContain("Assertion error thrown");
  });

  it("detects TypeScript compilation errors in output", () => {
    const stdout = `
src/index.ts:15:3 - error TS2322: Type 'string' is not assignable to type 'number'.
Found 1 error in src/index.ts.
`;
    const res = detectMaskedCommandFailure("npx tsc", stdout, "");
    expect(res.hasMaskedFailure).toBe(true);
    expect(res.reason).toContain("TypeScript");
  });

  it("detects ESLint errors in output", () => {
    const stdout = "2 problems (2 errors, 0 warnings)";
    const res = detectMaskedCommandFailure("npm run lint", stdout, "");
    expect(res.hasMaskedFailure).toBe(true);
    expect(res.reason).toContain("ESLint");
  });

  it("detects Windows cmd.exe 'The system cannot find the file specified.' error", () => {
    const stdout = "The system cannot find the file specified.\ndone";
    const res = detectMaskedCommandFailure("dir nonexistent & echo done", stdout, "");
    expect(res.hasMaskedFailure).toBe(true);
    expect(res.reason).toContain("Windows system cannot find file");
  });

  it("detects command not recognized error", () => {
    const stderr = "'foobar' is not recognized as an internal or external command";
    const res = detectMaskedCommandFailure("foobar", "", stderr);
    expect(res.hasMaskedFailure).toBe(true);
    expect(res.reason).toContain("Command not recognized");
  });

  it("detects git fatal error in stderr", () => {
    const stderr = "fatal: not a git repository (or any of the parent directories): .git";
    const res = detectMaskedCommandFailure("git status", "", stderr);
    expect(res.hasMaskedFailure).toBe(true);
    expect(res.reason).toContain("Git fatal error");
  });

  it("does not falsely flag commit messages containing 'fatal:' in git log stdout", () => {
    const stdout = "commit abc1234\nAuthor: Dev\n\n    fix fatal: authentication bypass";
    const res = detectMaskedCommandFailure("git log -n 1", stdout, "");
    expect(res.hasMaskedFailure).toBe(false);
  });
});
