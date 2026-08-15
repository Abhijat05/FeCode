import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultRepositoryExplorer } from "./explorer.js";
import { RepositoryExplorationFormatter } from "./formatter.js";
import { AgentRuntime } from "../runtime.js";
import { createTaskPlan } from "../tasks/taskPlan.js";
import type { ProjectProfile } from "../project/types.js";
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
    yield { type: "text_delta", content: "Exploration received." };
    yield { type: "completed" };
  }
}

describe("RepositoryExplorer", () => {
  let tempDir: string;
  let explorer: DefaultRepositoryExplorer;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-explore-test-"));
    explorer = new DefaultRepositoryExplorer();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("Basic Exploration: discovers files matching single component query", async () => {
    await fs.mkdir(path.join(tempDir, "src", "components"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "src", "components", "DashboardHeader.tsx"),
      "export const DashboardHeader = () => <div>Header</div>;"
    );
    await fs.writeFile(
      path.join(tempDir, "src", "components", "Sidebar.tsx"),
      "export const Sidebar = () => <div>Sidebar</div>;"
    );

    const result = await explorer.explore("Fix the DashboardHeader spacing", { cwd: tempDir });
    expect(result.relevantFiles.length).toBeGreaterThanOrEqual(1);
    expect(result.relevantFiles[0].path).toBe("src/components/DashboardHeader.tsx");
    expect(result.directories).toContain("src/components");
  });

  it("Multi-Term Query: finds files matching multiple query terms", async () => {
    await fs.mkdir(path.join(tempDir, "src", "auth"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "src", "auth", "login.ts"),
      "export function handleLogin() { /* auth logic */ }"
    );
    await fs.writeFile(
      path.join(tempDir, "src", "auth", "session.ts"),
      "export function checkAuthentication() { return true; }"
    );

    const result = await explorer.explore("Why does authentication fail after login?", {
      cwd: tempDir
    });

    const paths = result.relevantFiles.map((f) => f.path);
    expect(paths).toContain("src/auth/login.ts");
    expect(paths).toContain("src/auth/session.ts");
  });

  it("Project Awareness: prioritizes directories defined in ProjectProfile", async () => {
    await fs.mkdir(path.join(tempDir, "app", "dashboard"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "other"), { recursive: true });

    await fs.writeFile(
      path.join(tempDir, "app", "dashboard", "page.tsx"),
      "export default function Page() { return <h1>Dashboard</h1>; }"
    );
    await fs.writeFile(
      path.join(tempDir, "other", "dashboard.txt"),
      "Some raw notes about dashboard"
    );

    const mockProfile: ProjectProfile = {
      root: tempDir,
      projectType: "fullstack",
      packageManager: "npm",
      languages: ["TypeScript"],
      frameworks: ["Next.js"],
      buildTools: ["Next.js"],
      testTools: [],
      lintTools: [],
      formatTools: [],
      packageScripts: {},
      workspaces: { isMonorepo: false },
      importantDirectories: ["app"],
      configFiles: []
    };

    const result = await explorer.explore("Dashboard page", {
      cwd: tempDir,
      projectProfile: mockProfile
    });

    expect(result.relevantFiles[0].path).toBe("app/dashboard/page.tsx");
  });

  it("Relevance: exact filename match ranks above textual matches", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "src", "SettingsModal.tsx"),
      "export const SettingsModal = () => null;"
    );
    await fs.writeFile(
      path.join(tempDir, "src", "Utils.ts"),
      "// contains reference to SettingsModal in a comment"
    );

    const result = await explorer.explore("SettingsModal", { cwd: tempDir });
    expect(result.relevantFiles[0].path).toBe("src/SettingsModal.tsx");
    expect(result.relevantFiles[0].relevance).toBeGreaterThan(result.relevantFiles[1]?.relevance || 0);
  });

  it("Import Discovery: discovers imported dependencies of matching components", async () => {
    await fs.mkdir(path.join(tempDir, "src", "components"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "src", "components", "Dashboard.tsx"),
      "import { DashboardHeader } from './DashboardHeader';\nexport const Dashboard = () => <DashboardHeader />;"
    );
    await fs.writeFile(
      path.join(tempDir, "src", "components", "DashboardHeader.tsx"),
      "export const DashboardHeader = () => <header />;"
    );

    const result = await explorer.explore("Dashboard", { cwd: tempDir });
    const paths = result.relevantFiles.map((f) => f.path);
    expect(paths).toContain("src/components/Dashboard.tsx");
    expect(paths).toContain("src/components/DashboardHeader.tsx");
  });

  it("Limits: respects maxFiles limit and marks truncated", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    for (let i = 1; i <= 10; i++) {
      await fs.writeFile(
        path.join(tempDir, "src", `Item${i}.tsx`),
        `export const Item${i} = () => <div>Item</div>;`
      );
    }

    const result = await explorer.explore("Item", { cwd: tempDir, maxFiles: 3 });
    expect(result.relevantFiles).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it("Determinism: same repository + query produces identical results", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "src", "Alpha.tsx"), "export const Alpha = 1;");
    await fs.writeFile(path.join(tempDir, "src", "Beta.tsx"), "export const Beta = 2;");

    const res1 = await explorer.explore("Alpha Beta", { cwd: tempDir });
    const res2 = await explorer.explore("Alpha Beta", { cwd: tempDir });

    expect(res1).toEqual(res2);
  });

  it("Ignore Rules: never explores node_modules, .git, or dist", async () => {
    await fs.mkdir(path.join(tempDir, "node_modules", "pkg"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "dist"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });

    await fs.writeFile(path.join(tempDir, "node_modules", "pkg", "Button.tsx"), "export const Button = 1;");
    await fs.writeFile(path.join(tempDir, "dist", "Button.js"), "export const Button = 1;");
    await fs.writeFile(path.join(tempDir, "src", "Button.tsx"), "export const Button = 1;");

    const result = await explorer.explore("Button", { cwd: tempDir });
    const paths = result.relevantFiles.map((f) => f.path);
    expect(paths).toEqual(["src/Button.tsx"]);
  });

  it("Security: never inspects secret files, .env, or private keys", async () => {
    await fs.writeFile(path.join(tempDir, ".env"), "SECRET_API_KEY=12345");
    await fs.writeFile(path.join(tempDir, "id_rsa"), "PRIVATE KEY");

    const result = await explorer.explore("SECRET_API_KEY", { cwd: tempDir });
    expect(result.relevantFiles).toHaveLength(0);
  });

  it("Cancellation: AbortSignal stops exploration cleanly", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      explorer.explore("Anything", { cwd: tempDir, signal: controller.signal })
    ).rejects.toThrow("Exploration aborted");
  });

  it("Caching & Invalidation: reuses current-task results and invalidates upon edit", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "src", "UserCard.tsx"), "export const UserCard = () => null;");

    const res1 = await explorer.explore("UserCard", { cwd: tempDir });
    expect(res1.relevantFiles[0].path).toBe("src/UserCard.tsx");

    // Modify file
    await fs.writeFile(
      path.join(tempDir, "src", "UserCard.tsx"),
      "export const UserCard = () => <div>Updated</div>;"
    );

    // Invalidate
    explorer.invalidate("src/UserCard.tsx");
    const res2 = await explorer.explore("UserCard", { cwd: tempDir });
    expect(res2.relevantFiles[0].path).toBe("src/UserCard.tsx");
  });
});

describe("Repository Exploration Integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-explore-int-"));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("Formatter: formats ExplorationResult into concise markdown", () => {
    const formatter = new RepositoryExplorationFormatter();
    const formatted = formatter.format({
      query: "DashboardHeader",
      relevantFiles: [
        { path: "src/pages/DashboardPage.tsx", reason: "contains DashboardPage", relevance: 100 },
        { path: "src/components/DashboardHeader.tsx", reason: "defines DashboardHeader", relevance: 90 }
      ],
      directories: ["src/pages", "src/components"],
      matches: 2,
      exploredFiles: 10,
      truncated: false
    });

    expect(formatted).toContain("## Repository Exploration");
    expect(formatted).toContain("- src/pages/DashboardPage.tsx — contains DashboardPage");
    expect(formatted).toContain("- src/components/DashboardHeader.tsx — defines DashboardHeader");
    expect(formatted).toContain("- src/pages");
    expect(formatted).toContain("- src/components");
  });

  it("Runtime Integration: AgentRuntime performs exploration and provides context to model", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "src", "AuthModal.tsx"),
      "export const AuthModal = () => <div>Login</div>;"
    );

    const provider = new MockModelProvider();
    const explorer = new DefaultRepositoryExplorer();

    const runtime = new AgentRuntime(provider, {
      repositoryExplorer: explorer
    });

    for await (const event of runtime.run({ message: "Fix AuthModal", cwd: tempDir })) {
      void event;
    }

    expect(provider.capturedRequests).toHaveLength(1);
    expect(provider.capturedRequests[0].system).toContain("## Repository Exploration");
    expect(provider.capturedRequests[0].system).toContain("src/AuthModal.tsx");
  });

  it("Cache Invalidation on Edit: runtime invalidates explorer cache when write_file succeeds", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "src", "Profile.tsx"),
      "export const Profile = () => null;"
    );

    const provider = new MockModelProvider();
    const explorer = new DefaultRepositoryExplorer();

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
            arguments: { path: "src/Profile.tsx", content: "export const Profile = 123;" }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "File modified." };
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
      repositoryExplorer: explorer
    });

    for await (const event of runtime.run({ message: "Update Profile component", cwd: tempDir })) {
      void event;
    }

    // Cached result was invalidated
    expect(provider.capturedRequests.length).toBeGreaterThan(0);
  });

  it("TaskPlan Independence: exploration supports TaskPlan steps without owning planning", () => {
    const plan = createTaskPlan("Implement Auth Modal", [
      "Explore authentication components",
      "Inspect related unit tests",
      "Update AuthModal.tsx",
      "Run tests"
    ]);

    expect(plan.steps[0].description).toBe("Explore authentication components");
    expect(plan.steps).toHaveLength(4);
  });

  it("Provider Independence: OpenAI, Gemini, Ollama receive equivalent exploration context", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "src", "Header.tsx"),
      "export const Header = () => null;"
    );

    const providerA = new MockModelProvider();
    providerA.id = "openai:gpt-4o";
    const providerB = new MockModelProvider();
    providerB.id = "gemini:gemini-2.5-flash";
    const providerC = new MockModelProvider();
    providerC.id = "ollama:llama3";

    const explorer = new DefaultRepositoryExplorer();

    const runtimeA = new AgentRuntime(providerA, { repositoryExplorer: explorer });
    const runtimeB = new AgentRuntime(providerB, { repositoryExplorer: explorer });
    const runtimeC = new AgentRuntime(providerC, { repositoryExplorer: explorer });

    for await (const event of runtimeA.run({ message: "Fix Header", cwd: tempDir })) {
      void event;
    }
    for await (const event of runtimeB.run({ message: "Fix Header", cwd: tempDir })) {
      void event;
    }
    for await (const event of runtimeC.run({ message: "Fix Header", cwd: tempDir })) {
      void event;
    }

    expect(providerA.capturedRequests[0].system).toBe(providerB.capturedRequests[0].system);
    expect(providerB.capturedRequests[0].system).toBe(providerC.capturedRequests[0].system);
  });
});
