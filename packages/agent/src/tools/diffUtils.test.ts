import { describe, it, expect } from "vitest";
import { createUnifiedDiff } from "./diffUtils.js";

describe("createUnifiedDiff", () => {
  it("generates a clean unified diff for line replacements", () => {
    const orig = "line 1\nline 2 (old)\nline 3\n";
    const prop = "line 1\nline 2 (new)\nline 3\n";

    const diff = createUnifiedDiff("src/App.tsx", orig, prop);
    expect(diff).toContain("--- src/App.tsx");
    expect(diff).toContain("+++ src/App.tsx");
    expect(diff).toContain("-line 2 (old)");
    expect(diff).toContain("+line 2 (new)");
  });

  it("truncates very large diff outputs for display safety", () => {
    const origLines: string[] = [];
    const propLines: string[] = [];

    for (let i = 1; i <= 200; i++) {
      origLines.push(`line ${i} old`);
      propLines.push(`line ${i} new`);
    }

    const diff = createUnifiedDiff("large.txt", origLines.join("\n"), propLines.join("\n"), 3, 30);
    expect(diff).toContain("--- large.txt");
    expect(diff).toContain("diff display truncated");
  });
});
