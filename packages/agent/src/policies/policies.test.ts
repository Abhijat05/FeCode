import { describe, it, expect } from "vitest";
import { DEFAULT_CODING_POLICY } from "./defaultCodingPolicy.js";
import { DefaultAgentPolicyRegistry } from "./registry.js";
import { composeSystemPrompt } from "../skills/composer.js";
import { AgentRuntime } from "../runtime.js";
import type { AgentEvent } from "../index.js";
import type { ModelProvider, ModelRequest, ModelEvent, Tool, PermissionDecision } from "@fecode/models";
import type { Skill } from "../skills/types.js";
import type { ProjectContext } from "../project/types.js";

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

describe("Agent Policies Domain", () => {
  it("Policy Loading: Default policy loads successfully from DefaultAgentPolicyRegistry", () => {
    const registry = new DefaultAgentPolicyRegistry();
    expect(registry.has("default-coding")).toBe(true);

    const policy = registry.get("default-coding");
    expect(policy).toBeDefined();
    expect(policy!.name).toBe("default-coding");
    expect(policy!.instructions.length).toBeGreaterThan(5);
  });

  it("Formatting: Policies appear in system prompt with clean markdown formatting", () => {
    const registry = new DefaultAgentPolicyRegistry();
    const prompt = composeSystemPrompt({
      policies: registry.list()
    });

    expect(prompt).toContain("## FeCode Agent Policies");
    expect(prompt).toContain("### Policy: default-coding");
    expect(prompt).toContain("- Inspect Before Editing");
    expect(prompt).toContain("- Follow Existing Conventions");
    expect(prompt).toContain("- Minimal Changes");
    expect(prompt).toContain("- Reuse Existing Code");
    expect(prompt).toContain("- Dependency Discipline");
    expect(prompt).toContain("- No Premature Abstraction");
    expect(prompt).toContain("- Preserve Existing Behavior");
    expect(prompt).toContain("- Verify Changes");
    expect(prompt).toContain("- Honest Completion");
    expect(prompt).toContain("- Error Recovery");
    expect(prompt).toContain("- User Intent");
  });

  it("Separation: Agent policies, project context, and skills remain separate in priority order", () => {
    const registry = new DefaultAgentPolicyRegistry();
    const mockContext: ProjectContext = {
      projectRoot: "/test",
      projectType: "frontend",
      languages: ["typescript"],
      framework: "react",
      frameworks: ["react"],
      frameworkVersion: "18.2.0",
      buildTool: "vite",
      styling: ["tailwind"],
      testing: ["vitest"],
      packageManager: "npm",
      structure: {
        sourceDirectories: ["src"],
        componentDirectories: ["src/components"],
        routeDirectories: [],
        testDirectories: [],
        assetDirectories: []
      },
      scripts: {},
      configuration: {
        framework: [],
        styling: [],
        build: [],
        testing: []
      }
    };

    const mockSkill: Skill = {
      name: "react",
      version: "1.0.0",
      category: "framework",
      description: "React guidelines",
      instructions: ["Use hooks properly"],
      rules: ["Always clean up effects"]
    };

    const prompt = composeSystemPrompt({
      baseSystemPrompt: "You are FeCode.",
      policies: registry.list(),
      projectContext: mockContext,
      activeSkills: [mockSkill]
    });

    // Verify ordering: Base prompt -> Policies -> Project Context -> Active Skills
    const baseIdx = prompt.indexOf("You are FeCode.");
    const policyIdx = prompt.indexOf("## FeCode Agent Policies");
    const contextIdx = prompt.indexOf("## Project Context");
    const skillsIdx = prompt.indexOf("## Active FeCode Skills");

    expect(baseIdx).toBeGreaterThan(-1);
    expect(policyIdx).toBeGreaterThan(baseIdx);
    expect(contextIdx).toBeGreaterThan(policyIdx);
    expect(skillsIdx).toBeGreaterThan(contextIdx);
  });

  it("No Duplication: React/framework-specific instructions do not appear in default coding policy", () => {
    const policy = DEFAULT_CODING_POLICY;
    const combinedInstructions = policy.instructions.join(" ").toLowerCase();

    expect(combinedInstructions).not.toContain("usestate");
    expect(combinedInstructions).not.toContain("useeffect");
    expect(combinedInstructions).not.toContain("tailwind");
    expect(combinedInstructions).not.toContain("aria-");
    expect(combinedInstructions).not.toContain("jsx");
  });
});

describe("Agent Policies Runtime Integration", () => {
  const dummySkill1: Skill = {
    name: "react",
    version: "1.0.0",
    category: "framework",
    description: "React guidelines",
    instructions: ["Use hooks properly"]
  };

  const dummySkill2: Skill = {
    name: "frontend-testing",
    version: "1.0.0",
    category: "testing",
    description: "Testing guidelines",
    instructions: ["Write deterministic tests"]
  };

  const skillRegistry = {
    list: () => [dummySkill1, dummySkill2],
    register: () => {},
    get: (n: string) => (n === "react" ? dummySkill1 : dummySkill2),
    has: () => true
  };

  const activationPolicy = {
    activate: (msg: string) => {
      if (msg.includes("test")) return { skills: [dummySkill2] };
      return { skills: [dummySkill1] };
    }
  };

  it("Runtime: AgentRuntime includes policies in ModelRequest system prompt", async () => {
    const provider = new MockModelProvider();
    const runtime = new AgentRuntime(provider);

    for await (const event of runtime.run({ message: "Hello", cwd: "/test" })) {
      void event;
    }

    expect(provider.capturedRequests).toHaveLength(1);
    const system = provider.capturedRequests[0].system;
    expect(system).toContain("## FeCode Agent Policies");
    expect(system).toContain("Inspect Before Editing");
    expect(system).toContain("Minimal Changes");
  });

  it("Per-Turn: Policies remain stable across turns while active skills change", async () => {
    const provider = new MockModelProvider();
    const runtime = new AgentRuntime(provider, {
      skillRegistry,
      activationPolicy: activationPolicy as unknown as import("../skills/activation.js").SkillActivationPolicy
    });

    // Turn 1 (React task)
    for await (const event of runtime.run({ message: "Fix React component", cwd: "/test" })) {
      void event;
    }
    // Turn 2 (Testing task)
    for await (const event of runtime.run({ message: "Fix the failing test", cwd: "/test" })) {
      void event;
    }

    expect(provider.capturedRequests).toHaveLength(2);

    // Both turns must contain the stable Agent Policies
    expect(provider.capturedRequests[0].system).toContain("## FeCode Agent Policies");
    expect(provider.capturedRequests[1].system).toContain("## FeCode Agent Policies");

    // Turn 1 has react, Turn 2 has frontend-testing
    expect(provider.capturedRequests[0].system).toContain("### Skill: react");
    expect(provider.capturedRequests[0].system).not.toContain("### Skill: frontend-testing");

    expect(provider.capturedRequests[1].system).toContain("### Skill: frontend-testing");
    expect(provider.capturedRequests[1].system).not.toContain("### Skill: react");
  });

  it("Provider Independence: OpenAI, Gemini, Ollama receive equivalent policy context", async () => {
    const providerA = new MockModelProvider();
    providerA.id = "openai:gpt-4o";
    const providerB = new MockModelProvider();
    providerB.id = "gemini:gemini-2.5-flash";
    const providerC = new MockModelProvider();
    providerC.id = "ollama:llama3";

    const runtimeA = new AgentRuntime(providerA);
    const runtimeB = new AgentRuntime(providerB);
    const runtimeC = new AgentRuntime(providerC);

    for await (const event of runtimeA.run({ message: "Build component", cwd: "/test" })) {
      void event;
    }
    for await (const event of runtimeB.run({ message: "Build component", cwd: "/test" })) {
      void event;
    }
    for await (const event of runtimeC.run({ message: "Build component", cwd: "/test" })) {
      void event;
    }

    expect(providerA.capturedRequests[0].system).toBe(providerB.capturedRequests[0].system);
    expect(providerB.capturedRequests[0].system).toBe(providerC.capturedRequests[0].system);
  });

  it("Permissions: Agent policies cannot bypass PermissionManager approval requirements", async () => {
    const provider = new MockModelProvider();
    let approvalRequested = false;

    let turn = 0;
    // Simulate provider emitting a tool call on turn 1 and finishing on turn 2
    provider.generate = async function* () {
      turn++;
      if (turn === 1) {
        yield {
          type: "tool_call",
          call: {
            id: "call-1",
            name: "write_file",
            arguments: { path: "test.ts", content: "export const x = 1;" }
          }
        };
        yield { type: "completed" };
      } else {
        yield { type: "text_delta", content: "Done" };
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
      check: async (): Promise<PermissionDecision> => ({
        type: "requires_approval",
        reason: "Modifying file requires user confirmation"
      })
    };

    const runtime = new AgentRuntime(provider, {
      registry: toolRegistry,
      permissionManager
    });

    const events: AgentEvent[] = [];
    for await (const event of runtime.run({ message: "Edit test.ts", cwd: "/test" })) {
      events.push(event);
      if (event.type === "approval_required") {
        approvalRequested = true;
      }
    }

    // Must still require approval despite policies in prompt
    expect(approvalRequested).toBe(true);
    expect(events.some((e) => e.type === "approval_required")).toBe(true);
  });
});

describe("Behavioral Guidance Scenarios", () => {
  it("Scenario 1: 'Fix this component' provides inspect-before-edit and minimal-change guidance", async () => {
    const provider = new MockModelProvider();
    const runtime = new AgentRuntime(provider);

    for await (const event of runtime.run({ message: "Fix this component", cwd: "/test" })) {
      void event;
    }

    const system = provider.capturedRequests[0].system;
    expect(system).toContain("Inspect Before Editing");
    expect(system).toContain("search_files, read_file, or list_directory");
    expect(system).toContain("Minimal Changes");
  });

  it("Scenario 2: 'Add a utility for formatting dates' provides reuse-existing-code and avoid-premature-abstraction guidance", async () => {
    const provider = new MockModelProvider();
    const runtime = new AgentRuntime(provider);

    for await (const event of runtime.run({ message: "Add a utility for formatting dates", cwd: "/test" })) {
      void event;
    }

    const system = provider.capturedRequests[0].system;
    expect(system).toContain("Reuse Existing Code");
    expect(system).toContain("No Premature Abstraction");
    expect(system).toContain("Dependency Discipline");
  });

  it("Scenario 3: 'Fix the failing tests' provides inspect -> modify -> verify error recovery guidance", async () => {
    const provider = new MockModelProvider();
    const runtime = new AgentRuntime(provider);

    for await (const event of runtime.run({ message: "Fix the failing tests", cwd: "/test" })) {
      void event;
    }

    const system = provider.capturedRequests[0].system;
    expect(system).toContain("Verify Changes");
    expect(system).toContain("Error Recovery");
    expect(system).toContain("Honest Completion");
  });
});
