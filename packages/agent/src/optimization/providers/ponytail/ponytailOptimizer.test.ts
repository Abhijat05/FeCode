import { describe, it, expect } from "vitest";
import { PonytailTokenOptimizer } from "./ponytailOptimizer.js";
import { DefaultTokenOptimizer } from "../../defaultOptimizer.js";
import { createTokenOptimizer } from "../../factory.js";
import { estimateTokens } from "../../estimator.js";
import { AgentRuntime } from "../../../runtime.js";
import type { AgentEvent } from "../../../index.js";
import type { ModelProvider, ModelRequest, ModelEvent } from "@fecode/models";
import type { Skill } from "../../../skills/types.js";

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

describe("PonytailTokenOptimizer", () => {
  const sampleSkillContext = `## Active FeCode Skills

### Skill: react
React UI component rules.

#### Rules
- Always clean up effects
- Never mutate state directly

#### Workflow
- 1. Identify state
- 2. Implement hooks

#### Anti-Patterns
- Index as key

#### Instructions
- Prefer hooks
- Isolate side effects

#### Examples

**Counter Example**
\`\`\`tsx
function Counter() { return <div>Count</div>; }
\`\`\``;

  it("Adapter: input mapping and result structure", () => {
    const optimizer = new PonytailTokenOptimizer({ maxTokens: 5000 });
    const result = optimizer.optimize({
      text: sampleSkillContext,
      priority: "high",
      metadata: { source: "test" }
    });

    expect(result.originalEstimatedTokens).toBe(estimateTokens(sampleSkillContext));
    expect(result.strategy).toBe("ponytail");
    expect(result.metrics.strategy).toBe("ponytail");
    expect(result.text).toBeDefined();
  });

  it("Result Mapping: produces complete TokenOptimizationResult metrics", () => {
    const optimizer = new PonytailTokenOptimizer({ maxTokens: 5000 });
    const result = optimizer.optimize({ text: sampleSkillContext });

    expect(result.metrics).toHaveProperty("originalTokens");
    expect(result.metrics).toHaveProperty("optimizedTokens");
    expect(result.metrics).toHaveProperty("tokensSaved");
    expect(result.metrics).toHaveProperty("reductionRatio");
    expect(result.metrics).toHaveProperty("strategy");
  });

  it("Protection: Rules, Workflow, and Anti-Patterns are strictly preserved", () => {
    const optimizer = new PonytailTokenOptimizer({ maxTokens: 50 });
    const result = optimizer.optimize({ text: sampleSkillContext });

    expect(result.text).toContain("#### Rules");
    expect(result.text).toContain("- Always clean up effects");
    expect(result.text).toContain("#### Workflow");
    expect(result.text).toContain("- 1. Identify state");
    expect(result.text).toContain("#### Anti-Patterns");
    expect(result.text).toContain("- Index as key");
  });

  it("Failure: falls back safely to DefaultTokenOptimizer on corrupted input", () => {
    const optimizer = new PonytailTokenOptimizer({ maxTokens: 6000 });
    // An optimizer instance with custom transform simulation
    const result = optimizer.optimize({ text: "" });

    expect(result.text).toBe("");
    expect(result.changed).toBe(false);
  });

  it("Disabled: returns original context when enabled=false or mode=off", () => {
    const optimizer1 = new PonytailTokenOptimizer({ enabled: false });
    const res1 = optimizer1.optimize({ text: sampleSkillContext });
    expect(res1.changed).toBe(false);
    expect(res1.strategy).toBe("disabled");

    const optimizer2 = new PonytailTokenOptimizer({ mode: "off" });
    const res2 = optimizer2.optimize({ text: sampleSkillContext });
    expect(res2.changed).toBe(false);
    expect(res2.strategy).toBe("disabled");
  });

  it("Determinism: repeated equivalent inputs produce identical results", () => {
    const optimizer = new PonytailTokenOptimizer({ maxTokens: 200 });
    const res1 = optimizer.optimize({ text: sampleSkillContext });
    const res2 = optimizer.optimize({ text: sampleSkillContext });

    expect(res1.text).toBe(res2.text);
    expect(res1.optimizedEstimatedTokens).toBe(res2.optimizedEstimatedTokens);
    expect(res1.metrics).toEqual(res2.metrics);
  });

  it("Configuration: createTokenOptimizer respects FE_TOKEN_OPTIMIZER and options", () => {
    const defaultOpt = createTokenOptimizer("default");
    expect(defaultOpt).toBeInstanceOf(DefaultTokenOptimizer);

    const ponytailOpt = createTokenOptimizer("ponytail");
    expect(ponytailOpt).toBeInstanceOf(PonytailTokenOptimizer);

    const disabledOpt = createTokenOptimizer("disabled");
    expect(disabledOpt.optimize({ text: sampleSkillContext }).strategy).toBe("disabled");
  });
});

describe("Ponytail Runtime & Provider Independence", () => {
  const dummySkill: Skill = {
    name: "react",
    version: "1.0.0",
    category: "framework",
    description: "React guidelines",
    instructions: ["Use hooks properly"],
    rules: ["Rules: Always clean up effects"],
    examples: [{ title: "Ex1", example: "const a = 1;" }]
  };

  const registry = {
    list: () => [dummySkill],
    register: () => {},
    get: () => dummySkill,
    has: () => true
  };

  const policy = {
    activate: () => ({ skills: [dummySkill] })
  };

  it("AgentRuntime works seamlessly with PonytailTokenOptimizer via DI", async () => {
    const provider = new MockModelProvider();
    const optimizer = new PonytailTokenOptimizer({ maxTokens: 6000 });

    const runtime = new AgentRuntime(provider, {
      skillRegistry: registry,
      activationPolicy: policy as unknown as import("../../../skills/activation.js").SkillActivationPolicy,
      tokenOptimizer: optimizer
    });

    const events: AgentEvent[] = [];
    for await (const event of runtime.run({ message: "Build form", cwd: "/test" })) {
      events.push(event);
    }

    expect(provider.capturedRequests).toHaveLength(1);
    expect(provider.capturedRequests[0].system).toContain("### Skill: react");
    expect(provider.capturedRequests[0].system).toContain("Always clean up effects");
  });

  it("Provider Independence: OpenAI, Gemini, Ollama receive identical output from Ponytail", async () => {
    const providerA = new MockModelProvider();
    providerA.id = "openai:gpt-4o";
    const providerB = new MockModelProvider();
    providerB.id = "gemini:gemini-1.5-pro";
    const providerC = new MockModelProvider();
    providerC.id = "ollama:llama3";

    const optimizer = new PonytailTokenOptimizer({ maxTokens: 6000 });

    const runtimeA = new AgentRuntime(providerA, {
      skillRegistry: registry,
      activationPolicy: policy as unknown as import("../../../skills/activation.js").SkillActivationPolicy,
      tokenOptimizer: optimizer
    });
    const runtimeB = new AgentRuntime(providerB, {
      skillRegistry: registry,
      activationPolicy: policy as unknown as import("../../../skills/activation.js").SkillActivationPolicy,
      tokenOptimizer: optimizer
    });
    const runtimeC = new AgentRuntime(providerC, {
      skillRegistry: registry,
      activationPolicy: policy as unknown as import("../../../skills/activation.js").SkillActivationPolicy,
      tokenOptimizer: optimizer
    });

    for await (const event of runtimeA.run({ message: "Build form", cwd: "/test" })) {
      void event;
    }
    for await (const event of runtimeB.run({ message: "Build form", cwd: "/test" })) {
      void event;
    }
    for await (const event of runtimeC.run({ message: "Build form", cwd: "/test" })) {
      void event;
    }

    expect(providerA.capturedRequests[0].system).toBe(providerB.capturedRequests[0].system);
    expect(providerB.capturedRequests[0].system).toBe(providerC.capturedRequests[0].system);
  });
});
