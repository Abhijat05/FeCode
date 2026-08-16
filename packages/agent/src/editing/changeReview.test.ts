import { describe, it, expect } from "vitest";
import {
  calculateDiffStats,
  createChangeReview,
  ChangeReviewFormatter,
  type ChangeReviewFile
} from "./changeReview.js";

describe("ChangeReview and ChangeReviewFormatter — Phase 5D", () => {
  it("calculates diff stats accurately", () => {
    const diff = [
      "--- src/component.tsx",
      "+++ src/component.tsx",
      "@@ -10,5 +10,7 @@",
      " existing line 1",
      "-old line",
      "+new line 1",
      "+new line 2",
      " existing line 2"
    ].join("\n");

    const stats = calculateDiffStats(diff);
    expect(stats.additions).toBe(2);
    expect(stats.deletions).toBe(1);
  });

  it("handles empty or no-change diffs in stats calculation", () => {
    expect(calculateDiffStats("")).toEqual({ additions: 0, deletions: 0 });
    expect(
      calculateDiffStats("--- a.ts\n+++ a.ts\n@@ (No changes)")
    ).toEqual({ additions: 0, deletions: 0 });
  });

  it("formats single modified file review", () => {
    const file: ChangeReviewFile = {
      path: "src/components/LoginForm.tsx",
      operation: "modified",
      additions: 7,
      deletions: 1,
      diff: [
        "@@ -12,7 +12,13 @@",
        " function LoginForm() {",
        "+  const [loading, setLoading] = useState(false);",
        "+",
        "   const handleSubmit = async () => {",
        "+    setLoading(true);",
        "     ..."
      ].join("\n")
    };

    const formatted = ChangeReviewFormatter.formatSingleFileReview(file);
    expect(formatted).toContain("⚠ FeCode wants to modify a file");
    expect(formatted).toContain("File:\n  src/components/LoginForm.tsx");
    expect(formatted).toContain("Change:\n  +7 -1");
    expect(formatted).toContain("Diff:");
    expect(formatted).toContain("+  const [loading, setLoading] = useState(false);");
  });

  it("formats single created file review", () => {
    const file: ChangeReviewFile = {
      path: "src/components/Spinner.tsx",
      operation: "added",
      additions: 18,
      deletions: 0,
      diff: "+export function Spinner() {\n+  return <span>Loading...</span>;\n+}"
    };

    const formatted = ChangeReviewFormatter.formatSingleFileReview(file);
    expect(formatted).toContain("⚠ FeCode wants to create a file");
    expect(formatted).toContain("File:\n  src/components/Spinner.tsx");
    expect(formatted).toContain("Change:\n  +18 -0");
    expect(formatted).toContain("+export function Spinner()");
  });

  it("formats single deleted file review", () => {
    const file: ChangeReviewFile = {
      path: "src/legacy/OldButton.tsx",
      operation: "deleted",
      additions: 0,
      deletions: 42
    };

    const formatted = ChangeReviewFormatter.formatSingleFileReview(file);
    expect(formatted).toContain("⚠ FeCode wants to delete a file");
    expect(formatted).toContain("File:\n  src/legacy/OldButton.tsx");
    expect(formatted).toContain("Change:\n  +0 -42");
    expect(formatted).not.toContain("Diff:");
  });

  it("formats multi-file review with deterministic alphabetical ordering", () => {
    const files: ChangeReviewFile[] = [
      {
        path: "src/components/Spinner.tsx",
        operation: "added",
        additions: 18,
        deletions: 0,
        diff: "+export const Spinner = () => null;"
      },
      {
        path: "src/components/LoginForm.tsx",
        operation: "modified",
        additions: 12,
        deletions: 3,
        diff: "@@ -1,3 +1,3 @@\n-old\n+new"
      },
      {
        path: "src/components/LoginForm.test.tsx",
        operation: "modified",
        additions: 24,
        deletions: 0,
        diff: "+test('renders', () => {});"
      }
    ];

    const review = createChangeReview(files);
    expect(review.totalAddedLines).toBe(54);
    expect(review.totalRemovedLines).toBe(3);

    const formatted = ChangeReviewFormatter.formatMultiFileReview(review);
    expect(formatted).toContain("⚠ FeCode wants to modify 3 files");
    expect(formatted).toContain("M src/components/LoginForm.test.tsx");
    expect(formatted).toContain("M src/components/LoginForm.tsx");
    expect(formatted).toContain("A src/components/Spinner.tsx");
    expect(formatted).toContain("Total:\n  +54 -3");

    // Check alphabetical order
    const testIndex = formatted.indexOf("LoginForm.test.tsx");
    const loginIndex = formatted.indexOf("LoginForm.tsx");
    const spinnerIndex = formatted.indexOf("Spinner.tsx");
    expect(testIndex).toBeLessThan(loginIndex);
    expect(loginIndex).toBeLessThan(spinnerIndex);
  });

  it("redacts secrets in displayed diffs without affecting underlying structures", () => {
    const file: ChangeReviewFile = {
      path: "src/config.ts",
      operation: "modified",
      additions: 1,
      deletions: 1,
      diff: "+const token = 'Bearer sk-abcdef1234567890abcdef1234567890';"
    };

    const formatted = ChangeReviewFormatter.formatSingleFileReview(file);
    expect(formatted).not.toContain("sk-abcdef1234567890abcdef1234567890");
    expect(formatted).toContain("[REDACTED_SECRET]");
    // Underlying diff remains unaltered
    expect(file.diff).toContain("sk-abcdef1234567890abcdef1234567890");
  });

  it("truncates large diffs cleanly", () => {
    const longDiffLines = Array.from(
      { length: 150 },
      (_, i) => `+line ${i + 1} added content`
    );
    const file: ChangeReviewFile = {
      path: "src/large.ts",
      operation: "modified",
      additions: 150,
      deletions: 0,
      diff: longDiffLines.join("\n")
    };

    const formatted = ChangeReviewFormatter.formatSingleFileReview(file, {
      maxLines: 40
    });
    expect(formatted).toContain("... (diff display truncated; 110 lines omitted) ...");
    expect(formatted).toContain("+line 1 added content");
    expect(formatted).toContain("+line 150 added content");
  });

  it("normalizes Windows path separators in display", () => {
    const file: ChangeReviewFile = {
      path: "src\\components\\Button.tsx",
      operation: "modified",
      additions: 5,
      deletions: 2,
      diff: "@@ -1 +1 @@\n-old\n+new"
    };

    const formatted = ChangeReviewFormatter.formatSingleFileReview(file);
    expect(formatted).toContain("src/components/Button.tsx");
    expect(formatted).not.toContain("src\\components\\Button.tsx");
  });
});
