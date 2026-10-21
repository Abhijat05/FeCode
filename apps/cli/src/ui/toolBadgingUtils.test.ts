import { describe, it, expect } from "vitest";
import { getToolBadgeInfo, formatCompactToolInvocation } from "./toolBadgingUtils.js";

describe("Semantic Typographic Tool Badging (toolBadgingUtils.ts)", () => {
  it("categorizes read tools as cyan/safe", () => {
    const info = getToolBadgeInfo("read_file");
    expect(info.category).toBe("read");
    expect(info.color).toBe("cyan");
    expect(getToolBadgeInfo("search_files").category).toBe("read");
    expect(getToolBadgeInfo("find_by_name").category).toBe("read");
  });

  it("categorizes mutate/edit tools as yellow/attention", () => {
    const info = getToolBadgeInfo("edit_file");
    expect(info.category).toBe("mutate");
    expect(info.color).toBe("yellow");
    expect(getToolBadgeInfo("write_file").category).toBe("mutate");
    expect(getToolBadgeInfo("patch_content").category).toBe("mutate");
  });

  it("categorizes execution/shell tools as magenta/environment", () => {
    const info = getToolBadgeInfo("run_command");
    expect(info.category).toBe("execute");
    expect(info.color).toBe("magenta");
    expect(getToolBadgeInfo("bash").category).toBe("execute");
  });

  it("formats single-line compact tool invocation", () => {
    expect(formatCompactToolInvocation("bash", undefined, "npm test")).toBe("bash(npm test)");
    expect(formatCompactToolInvocation("read_file", "packages/agent/src/index.ts")).toBe(
      "read_file(packages/agent/src/index.ts)"
    );
    expect(formatCompactToolInvocation("edit_file", "src/ui/Header.tsx")).toBe(
      "edit_file(src/ui/Header.tsx)"
    );
    expect(formatCompactToolInvocation("bash")).toBe("bash");
  });
});
