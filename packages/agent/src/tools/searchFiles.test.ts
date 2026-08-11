import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { SearchFilesTool } from "./searchFiles.js";
import type { ToolContext } from "@fecode/models";

describe("SearchFilesTool", () => {
  let tmpDir: string;
  let tool: SearchFilesTool;
  let context: ToolContext;
  const controller = new AbortController();

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-search-files-test-"));
    tool = new SearchFilesTool();
    context = { cwd: tmpDir, signal: controller.signal };

    // Setup project directory structure
    await fs.mkdir(path.join(tmpDir, "src"));
    await fs.mkdir(path.join(tmpDir, "src", "pages"));
    await fs.mkdir(path.join(tmpDir, "node_modules"));
    await fs.mkdir(path.join(tmpDir, "dist"));

    await fs.writeFile(
      path.join(tmpDir, "src", "pages", "Dashboard.tsx"),
      "import React from 'react';\n\nexport function Dashboard() {\n  return <div>Dashboard View</div>;\n}\n"
    );

    await fs.writeFile(
      path.join(tmpDir, "src", "index.ts"),
      "import { Dashboard } from './pages/Dashboard.js';\nconsole.log('App ready');\n"
    );

    // File inside ignored node_modules
    await fs.writeFile(
      path.join(tmpDir, "node_modules", "package.json"),
      '{"name": "Dashboard"}'
    );

    // Ignored binary file
    await fs.writeFile(
      path.join(tmpDir, "src", "logo.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00])
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("finds text recursively in files with case-insensitive matching", async () => {
    const result = await tool.execute({ query: "dashboard" }, context);
    expect(result.success).toBe(true);
    expect(result.output?.query).toBe("dashboard");

    const matches = result.output?.matches || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);

    const dashboardMatch = matches.find((m) =>
      m.path.includes("Dashboard.tsx") && m.text.includes("export function Dashboard")
    );
    expect(dashboardMatch).toBeDefined();
    expect(dashboardMatch?.line).toBe(3);
    expect(dashboardMatch?.column).toBe(17);
  });

  it("restricts search to a specific relative subpath", async () => {
    const result = await tool.execute({ query: "Dashboard", path: "src/pages" }, context);
    expect(result.success).toBe(true);
    expect(result.output?.matches).toHaveLength(2);
    expect(result.output?.matches[0].path).toContain("Dashboard.tsx");
  });

  it("skips ignored directories like node_modules, dist, and binary files", async () => {
    const result = await tool.execute({ query: "Dashboard" }, context);
    expect(result.success).toBe(true);

    const paths = result.output?.matches.map((m) => m.path) || [];
    expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
    expect(paths.some((p) => p.includes("logo.png"))).toBe(false);
  });

  it("rejects path traversal outside project root", async () => {
    const result = await tool.execute({ query: "test", path: "../../" }, context);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("PATH_OUT_OF_BOUNDS");
  });

  it("returns error INVALID_ARGUMENT when query is empty", async () => {
    const result = await tool.execute({ query: "   " }, context);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("INVALID_ARGUMENT");
  });

  it("truncates matches when maxResults limit is reached", async () => {
    const result = await tool.execute({ query: "Dashboard", maxResults: 1 }, context);
    expect(result.success).toBe(true);
    expect(result.output?.matches).toHaveLength(1);
    expect(result.output?.truncated).toBe(true);
  });

  it("returns matches in deterministic sorted order (by path, then line, then column)", async () => {
    const result = await tool.execute({ query: "Dashboard" }, context);
    expect(result.success).toBe(true);

    const matches = result.output?.matches || [];
    for (let i = 1; i < matches.length; i++) {
      const prev = matches[i - 1];
      const curr = matches[i];
      const pathCmp = prev.path.localeCompare(curr.path);
      if (pathCmp === 0) {
        if (prev.line === curr.line) {
          expect(prev.column).toBeLessThanOrEqual(curr.column);
        } else {
          expect(prev.line).toBeLessThan(curr.line);
        }
      } else {
        expect(pathCmp).toBeLessThan(0);
      }
    }
  });
});
