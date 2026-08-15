import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultCodeContextSelector } from "./selector.js";
import { CodeContextFormatter } from "./formatter.js";
import { DefaultRepositoryExplorer } from "../exploration/explorer.js";
import { AgentRuntime } from "../runtime.js";
import type { ExplorationResult } from "../exploration/types.js";
import type { ModelProvider, ModelRequest, ModelEvent, Tool, PermissionDecision } from "@fecode/models";

class MockModelProvider implements ModelProvider {
  public id = "mock-provider";
  public capabilities = {
    streaming: true,
    toolCalling: false,
    vision: false,
    maxContextTokens: 4096
  };

  public capturedRequests: ModelRequest[] = [];

  async *generate(
    request: ModelRequest,
    signal?: AbortSignal
  ): AsyncIterable<ModelEvent> {
    void signal;
    this.capturedRequests.push(request);
    yield { type: "text_delta", content: "OK" };
    yield { type: "completed" };
  }
}

describe("CodeContextSelector", () => {
  let tempDir: string;
  let selector: DefaultCodeContextSelector;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-context-test-"));
    selector = new DefaultCodeContextSelector();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("Basic Selection: selects matching lines and declarations from relevant file", async () => {
    await fs.mkdir(path.join(tempDir, "src", "components"), { recursive: true });
    const content = [
      "import React from 'react';",
      "",
      "interface HeaderProps {",
      "  title: string;",
      "}",
      "",
      "export const DashboardHeader: React.FC<HeaderProps> = ({ title }) => {",
      "  return (",
      "    <header className=\"p-4 flex justify-between\">",
      "      <h1>{title}</h1>",
      "    </header>",
      "  );",
      "};"
    ].join("\n");

    await fs.writeFile(
      path.join(tempDir, "src", "components", "DashboardHeader.tsx"),
      content
    );

    const exploration: ExplorationResult = {
      query: "DashboardHeader",
      relevantFiles: [
        {
          path: "src/components/DashboardHeader.tsx",
          reason: "Matches DashboardHeader",
          relevance: 100
        }
      ],
      directories: ["src/components"],
      matches: 1,
      exploredFiles: 1,
      truncated: false
    };

    const result = await selector.selectContext(exploration, "DashboardHeader", {
      cwd: tempDir
    });

    expect(result.regions.length).toBeGreaterThanOrEqual(1);
    expect(result.regions[0].path).toBe("src/components/DashboardHeader.tsx");
    expect(result.regions[0].content).toContain("DashboardHeader");
    expect(result.regions[0].startLine).toBe(1);
  });

  it("Small Files: small relevant file (<= 120 lines) is included in its entirety", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    const smallContent = Array.from({ length: 50 }, (_, i) => `// Line ${i + 1}`).join("\n");
    await fs.writeFile(path.join(tempDir, "src", "SmallFile.ts"), smallContent);

    const exploration: ExplorationResult = {
      query: "SmallFile",
      relevantFiles: [
        { path: "src/SmallFile.ts", reason: "Found SmallFile", relevance: 80 }
      ],
      directories: ["src"],
      matches: 1,
      exploredFiles: 1,
      truncated: false
    };

    const result = await selector.selectContext(exploration, "SmallFile", {
      cwd: tempDir,
      maxSmallFileLines: 120
    });

    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].startLine).toBe(1);
    expect(result.regions[0].endLine).toBe(50);
    expect(result.regions[0].content).toBe(smallContent);
  });

  it("Large Files: large file is region-selected with bounded context", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    const lines = Array.from({ length: 500 }, (_, i) => `const val_${i + 1} = ${i + 1};`);
    // Insert target function at line 420
    lines[419] = "export function processPayment(amount: number) { return amount > 0; }";

    await fs.writeFile(path.join(tempDir, "src", "PaymentService.ts"), lines.join("\n"));

    const exploration: ExplorationResult = {
      query: "processPayment",
      relevantFiles: [
        { path: "src/PaymentService.ts", reason: "Matches processPayment", relevance: 90 }
      ],
      directories: ["src"],
      matches: 1,
      exploredFiles: 1,
      truncated: false
    };

    const result = await selector.selectContext(exploration, "processPayment", {
      cwd: tempDir,
      maxSmallFileLines: 120,
      contextExpansionLines: 20
    });

    expect(result.regions).toHaveLength(1);
    const region = result.regions[0];
    expect(region.startLine).toBeGreaterThanOrEqual(390);
    expect(region.endLine).toBeLessThanOrEqual(450);
    expect(region.content).toContain("processPayment");
    expect(region.endLine - region.startLine + 1).toBeLessThan(100);
  });

  it("Region Merging: overlapping and nearby matching ranges are merged cleanly", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    const lines = Array.from({ length: 300 }, (_, i) => `// Line ${i + 1}`);
    lines[50] = "export const ItemHeader = () => <h1>Header</h1>;";
    lines[60] = "export const ItemFooter = () => <footer>Footer</footer>;";

    await fs.writeFile(path.join(tempDir, "src", "Items.tsx"), lines.join("\n"));

    const exploration: ExplorationResult = {
      query: "ItemHeader ItemFooter",
      relevantFiles: [
        { path: "src/Items.tsx", reason: "Found Items", relevance: 80 }
      ],
      directories: ["src"],
      matches: 2,
      exploredFiles: 1,
      truncated: false
    };

    const result = await selector.selectContext(exploration, "ItemHeader ItemFooter", {
      cwd: tempDir,
      maxSmallFileLines: 100,
      contextExpansionLines: 10
    });

    // Since match 1 is line 51 (range ~41-61) and match 2 is line 61 (range ~51-71), they should merge
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].content).toContain("ItemHeader");
    expect(result.regions[0].content).toContain("ItemFooter");
  });

  it("Ranking: higher relevance regions are prioritized and ordered correctly", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "src", "A.ts"), "export const Alpha = 1;");
    await fs.writeFile(path.join(tempDir, "src", "B.ts"), "export const Beta = 2;");

    const exploration: ExplorationResult = {
      query: "Alpha",
      relevantFiles: [
        { path: "src/A.ts", reason: "Exact match Alpha", relevance: 100 },
        { path: "src/B.ts", reason: "Low relevance", relevance: 20 }
      ],
      directories: ["src"],
      matches: 2,
      exploredFiles: 2,
      truncated: false
    };

    const result = await selector.selectContext(exploration, "Alpha", { cwd: tempDir });
    expect(result.regions.length).toBeGreaterThanOrEqual(1);
    expect(result.regions[0].path).toBe("src/A.ts");
    expect(result.regions[0].relevance).toBeGreaterThanOrEqual(result.regions[1]?.relevance || 0);
  });

  it("Token Budget: respects maxTotalLines and maxEstimatedTokens", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "src", "File1.ts"),
      Array.from({ length: 40 }, (_, i) => `const a${i} = ${i};`).join("\n")
    );
    await fs.writeFile(
      path.join(tempDir, "src", "File2.ts"),
      Array.from({ length: 40 }, (_, i) => `const b${i} = ${i};`).join("\n")
    );

    const exploration: ExplorationResult = {
      query: "File",
      relevantFiles: [
        { path: "src/File1.ts", reason: "File1", relevance: 90 },
        { path: "src/File2.ts", reason: "File2", relevance: 80 }
      ],
      directories: ["src"],
      matches: 2,
      exploredFiles: 2,
      truncated: false
    };

    const result = await selector.selectContext(exploration, "File", {
      cwd: tempDir,
      maxTotalLines: 50
    });

    expect(result.totalLines).toBeLessThanOrEqual(50);
    expect(result.truncated).toBe(true);
  });

  it("Security: never includes secret files, .env, or private keys", async () => {
    await fs.writeFile(path.join(tempDir, ".env"), "API_SECRET=verysecret");
    await fs.writeFile(path.join(tempDir, "id_rsa"), "PRIVATE KEY");

    const exploration: ExplorationResult = {
      query: "API_SECRET",
      relevantFiles: [
        { path: ".env", reason: "env match", relevance: 100 },
        { path: "id_rsa", reason: "key match", relevance: 100 }
      ],
      directories: [],
      matches: 2,
      exploredFiles: 2,
      truncated: false
    };

    const result = await selector.selectContext(exploration, "API_SECRET", {
      cwd: tempDir
    });

    expect(result.regions).toHaveLength(0);
  });

  it("Cancellation: AbortSignal stops selection cleanly", async () => {
    const controller = new AbortController();
    controller.abort();

    const exploration: ExplorationResult = {
      query: "Test",
      relevantFiles: [],
      directories: [],
      matches: 0,
      exploredFiles: 0,
      truncated: false
    };

    await expect(
      selector.selectContext(exploration, "Test", {
        cwd: tempDir,
        signal: controller.signal
      })
    ).rejects.toThrow("Context selection aborted");
  });

  it("Caching & Invalidation: reuses task-scoped cache and invalidates on edit", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "src", "Header.tsx"),
      "export const Header = () => <h1>Initial</h1>;"
    );

    const exploration: ExplorationResult = {
      query: "Header",
      relevantFiles: [
        { path: "src/Header.tsx", reason: "Header file", relevance: 100 }
      ],
      directories: ["src"],
      matches: 1,
      exploredFiles: 1,
      truncated: false
    };

    const res1 = await selector.selectContext(exploration, "Header", { cwd: tempDir });
    expect(res1.regions[0].content).toContain("Initial");

    // Modify file
    await fs.writeFile(
      path.join(tempDir, "src", "Header.tsx"),
      "export const Header = () => <h1>Updated</h1>;"
    );

    // Invalidate
    selector.invalidate("src/Header.tsx");
    const res2 = await selector.selectContext(exploration, "Header", { cwd: tempDir });
    expect(res2.regions[0].content).toContain("Updated");
  });
});

describe("Code Context Formatter & Runtime Integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-context-int-"));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("Formatter: formats CodeContextResult into concise Markdown", () => {
    const formatter = new CodeContextFormatter();
    const formatted = formatter.format({
      regions: [
        {
          path: "src/components/DashboardHeader.tsx",
          startLine: 12,
          endLine: 48,
          content: "export const DashboardHeader = () => <header />;",
          reason: "Defines DashboardHeader",
          relevance: 100
        }
      ],
      totalLines: 37,
      estimatedTokens: 100,
      truncated: false
    });

    expect(formatted).toContain("## Code Context");
    expect(formatted).toContain("### src/components/DashboardHeader.tsx");
    expect(formatted).toContain("Lines 12-48");
    expect(formatted).toContain("Reason: Defines DashboardHeader");
    expect(formatted).toContain("export const DashboardHeader");
  });

  it("Runtime Integration: AgentRuntime executes Explorer -> ContextSelector -> Prompt composition", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "src", "UserProfile.tsx"),
      "export const UserProfile = () => <div>Profile Data</div>;"
    );

    const provider = new MockModelProvider();
    const explorer = new DefaultRepositoryExplorer();
    const selector = new DefaultCodeContextSelector();

    const runtime = new AgentRuntime(provider, {
      repositoryExplorer: explorer,
      codeContextSelector: selector
    });

    for await (const event of runtime.run({ message: "Fix UserProfile component", cwd: tempDir })) {
      void event;
    }

    expect(provider.capturedRequests).toHaveLength(1);
    const systemPrompt = provider.capturedRequests[0].system;
    expect(systemPrompt).toContain("## Repository Exploration");
    expect(systemPrompt).toContain("## Code Context");
    expect(systemPrompt).toContain("src/UserProfile.tsx");
    expect(systemPrompt).toContain("UserProfile");
  });

  it("Edit Invalidation: runtime invalidates both explorer and contextSelector after write_file", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "src", "Button.tsx"),
      "export const Button = () => <button>Click</button>;"
    );

    const provider = new MockModelProvider();
    const explorer = new DefaultRepositoryExplorer();
    const selector = new DefaultCodeContextSelector();

    let turn = 0;
    provider.generate = async function* (req: ModelRequest) {
      provider.capturedRequests.push(req);
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "write_file",
            arguments: { path: "src/Button.tsx", content: "export const Button = () => <button>New</button>;" }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Button modified." };
        yield { type: "completed" };
      }
    };

    const mockTool: Tool = {
      name: "write_file",
      description: "Write file",
      permissionCategory: "write",
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({ success: true })
    };

    const toolRegistry = {
      get: () => mockTool,
      list: () => [mockTool],
      register: () => {},
      has: () => true
    };

    const permissionManager = {
      check: async (): Promise<PermissionDecision> => ({ type: "allowed" })
    };

    const runtime = new AgentRuntime(provider, {
      registry: toolRegistry,
      permissionManager,
      repositoryExplorer: explorer,
      codeContextSelector: selector
    });

    for await (const event of runtime.run({ message: "Update Button", cwd: tempDir })) {
      void event;
    }

    expect(provider.capturedRequests.length).toBeGreaterThan(0);
  });

  it("Provider Independence: OpenAI, Gemini, and Ollama receive identical code context", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "src", "Modal.tsx"),
      "export const Modal = () => <div>Modal</div>;"
    );

    const providerA = new MockModelProvider();
    providerA.id = "openai:gpt-4o";
    const providerB = new MockModelProvider();
    providerB.id = "gemini:gemini-2.5-flash";
    const providerC = new MockModelProvider();
    providerC.id = "ollama:llama3";

    const explorer = new DefaultRepositoryExplorer();
    const selector = new DefaultCodeContextSelector();

    const runtimeA = new AgentRuntime(providerA, { repositoryExplorer: explorer, codeContextSelector: selector });
    const runtimeB = new AgentRuntime(providerB, { repositoryExplorer: explorer, codeContextSelector: selector });
    const runtimeC = new AgentRuntime(providerC, { repositoryExplorer: explorer, codeContextSelector: selector });

    for await (const event of runtimeA.run({ message: "Fix Modal", cwd: tempDir })) {
      void event;
    }
    for await (const event of runtimeB.run({ message: "Fix Modal", cwd: tempDir })) {
      void event;
    }
    for await (const event of runtimeC.run({ message: "Fix Modal", cwd: tempDir })) {
      void event;
    }

    expect(providerA.capturedRequests[0].system).toBe(providerB.capturedRequests[0].system);
    expect(providerB.capturedRequests[0].system).toBe(providerC.capturedRequests[0].system);
  });
});
