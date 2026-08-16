import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultAgentExecutionStrategy } from "./executionStrategy.js";
import { DefaultRepositoryExplorer } from "../exploration/explorer.js";
import { DefaultCodeContextSelector } from "../context/selector.js";
import { AgentRuntime } from "../runtime.js";
import type { ModelProvider, ModelRequest, ModelEvent } from "@fecode/models";
import type { ProjectProfile } from "../project/types.js";

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

describe("DefaultAgentExecutionStrategy", () => {
  let strategy: DefaultAgentExecutionStrategy;

  beforeEach(() => {
    strategy = new DefaultAgentExecutionStrategy();
  });

  describe("Intent Detection", () => {
    it("Conceptual question -> answer intent without repository exploration", () => {
      const decision1 = strategy.decide("What is React?");
      expect(decision1.intent).toBe("answer");
      expect(decision1.shouldExplore).toBe(false);
      expect(decision1.shouldSelectContext).toBe(false);
      expect(decision1.requiresPlanning).toBe(false);

      const decision2 = strategy.decide("What is a hook?");
      expect(decision2.intent).toBe("answer");
      expect(decision2.shouldExplore).toBe(false);
    });

    it("Repository question -> explore intent with repository exploration", () => {
      const decision1 = strategy.decide("Where is DashboardHeader defined?");
      expect(decision1.intent).toBe("explore");
      expect(decision1.shouldExplore).toBe(true);
      expect(decision1.shouldSelectContext).toBe(false);
      expect(decision1.requiresPlanning).toBe(false);

      const decision2 = strategy.decide("Explain project structure");
      expect(decision2.intent).toBe("explore");
      expect(decision2.shouldExplore).toBe(true);
    });

    it("Inspection request -> inspect intent with exploration and context selection", () => {
      const decision = strategy.decide("What does DashboardPage render?");
      expect(decision.intent).toBe("inspect");
      expect(decision.shouldExplore).toBe(true);
      expect(decision.shouldSelectContext).toBe(true);
      expect(decision.requiresPlanning).toBe(false);
    });

    it("Implementation request -> implement intent with exploration and context selection", () => {
      const decision = strategy.decide("Fix the DashboardHeader spacing");
      expect(decision.intent).toBe("implement");
      expect(decision.shouldExplore).toBe(true);
      expect(decision.shouldSelectContext).toBe(true);
    });

    it("Verification request -> verify intent with execute_command recommendation", () => {
      const decision1 = strategy.decide("Run the tests");
      expect(decision1.intent).toBe("verify");
      expect(decision1.shouldExplore).toBe(false);
      expect(decision1.recommendedTools).toContain("execute_command");

      const decision2 = strategy.decide("Check for type errors");
      expect(decision2.intent).toBe("verify");
    });
  });

  describe("Planning & Complexity Threshold", () => {
    it("Simple targeted change does not require TaskPlan", () => {
      const decision = strategy.decide("Change the button text to Save");
      expect(decision.intent).toBe("implement");
      expect(decision.requiresPlanning).toBe(false);
      expect(decision.phase).toBe("implementing");
    });

    it("Complex multi-part change requires TaskPlan", () => {
      const decision = strategy.decide(
        "Add authentication with protected routes and tests"
      );
      expect(decision.intent).toBe("implement");
      expect(decision.requiresPlanning).toBe(true);
      expect(decision.phase).toBe("planning");
    });
  });

  describe("Project Profile Awareness", () => {
    it("Informs strategy with framework and package manager conventions", () => {
      const mockProfile: ProjectProfile = {
        root: "/test",
        projectType: "frontend",
        framework: "Next.js",
        frameworks: ["Next.js"],
        languages: ["TypeScript"],
        packageManager: "pnpm",
        buildTools: ["next"],
        testTools: ["vitest"],
        lintTools: ["eslint"],
        formatTools: ["prettier"],
        packageScripts: {},
        workspaces: { isMonorepo: false },
        importantDirectories: ["src/app"],
        configFiles: ["next.config.js"]
      };

      const decision = strategy.decide("Fix login flow", {
        projectProfile: mockProfile
      });

      expect(decision.guidance).toContain("Next.js");
      expect(decision.guidance).toContain("pnpm");
      expect(decision.guidance).toContain("read-first principle");
    });
  });
});

describe("Execution Strategy Runtime Coordination", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-strat-int-"));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("Runtime Integration: skips exploration for conceptual question but runs it for implementation", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "src", "Header.tsx"),
      "export const Header = () => <header>Header</header>;\n"
    );

    const provider = new MockModelProvider();
    const explorer = new DefaultRepositoryExplorer();
    const selector = new DefaultCodeContextSelector();

    const runtime = new AgentRuntime(provider, {
      repositoryExplorer: explorer,
      codeContextSelector: selector
    });

    // 1. Conceptual question
    for await (const event of runtime.run({ message: "What is React?", cwd: tempDir })) {
      void event;
    }
    const conceptualPrompt = provider.capturedRequests[0].system;
    expect(conceptualPrompt).not.toContain("## Repository Exploration");
    expect(conceptualPrompt).toContain("## Execution Strategy Guidance");

    // 2. Implementation request
    for await (const event of runtime.run({ message: "Fix Header component", cwd: tempDir })) {
      void event;
    }
    const implementPrompt = provider.capturedRequests[1].system;
    expect(implementPrompt).toContain("## Repository Exploration");
    expect(implementPrompt).toContain("## Code Context");
    expect(implementPrompt).toContain("read-first principle");
  });

  it("Provider Independence: OpenAI, Gemini, and Ollama receive identical strategic guidance", async () => {
    const providerA = new MockModelProvider();
    providerA.id = "openai:gpt-4o";
    const providerB = new MockModelProvider();
    providerB.id = "gemini:gemini-2.5-flash";
    const providerC = new MockModelProvider();
    providerC.id = "ollama:llama3";

    const runtimeA = new AgentRuntime(providerA);
    const runtimeB = new AgentRuntime(providerB);
    const runtimeC = new AgentRuntime(providerC);

    for await (const event of runtimeA.run({ message: "What is a closure?", cwd: tempDir })) {
      void event;
    }
    for await (const event of runtimeB.run({ message: "What is a closure?", cwd: tempDir })) {
      void event;
    }
    for await (const event of runtimeC.run({ message: "What is a closure?", cwd: tempDir })) {
      void event;
    }

    expect(providerA.capturedRequests[0].system).toBe(providerB.capturedRequests[0].system);
    expect(providerB.capturedRequests[0].system).toBe(providerC.capturedRequests[0].system);
  });
});
