import { describe, it, expect } from "vitest";
import { DefaultTokenOptimizer } from "./defaultOptimizer.js";
import { estimateTokens } from "./estimator.js";
import { AgentRuntime } from "../runtime.js";
import type { AgentEvent } from "../index.js";
import type { ModelProvider, ModelRequest, ModelEvent } from "@fecode/models";
import type { Skill } from "../skills/types.js";
import type { TokenOptimizer, TokenOptimizationInput, TokenOptimizationResult } from "./types.js";

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

describe("DefaultTokenOptimizer", () => {
  const sampleSkillContext = `## Active FeCode Skills

### Skill: react
React UI development guidelines and best practices for building robust components.

#### Rules
- Always clean up effects
- Never mutate state directly

#### Workflow
- 1. Identify state ownership
- 2. Implement hooks

#### Anti-Patterns
- Index as key in dynamic lists

#### Instructions
- Use hooks effectively
- Prefer derived state

#### Examples

**Good Example**
\`\`\`tsx
function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
\`\`\`

**Another Example**
\`\`\`tsx
function Profile({ id }: { id: string }) {
  return <div>{id}</div>;
}
\`\`\`

---

### Skill: tailwind
Tailwind CSS utility styling.

#### Instructions
- Use utility classes
- Follow spacing scales

#### Examples

**Button Example**
\`\`\`html
<button class="px-4 py-2 bg-blue-500 text-white rounded">Submit</button>
\`\`\``;

  it("Basic: text below budget is unchanged with changed=false", () => {
    const optimizer = new DefaultTokenOptimizer({ maxTokens: 5000 });
    const result = optimizer.optimize({ text: sampleSkillContext });

    expect(result.changed).toBe(false);
    expect(result.strategy).toBe("none");
    expect(result.text).toBe(sampleSkillContext);
    expect(result.originalEstimatedTokens).toBe(result.optimizedEstimatedTokens);
    expect(result.metrics.tokensSaved).toBe(0);
    expect(result.metrics.reductionRatio).toBe(0);
  });

  it("Over Budget: reduces context when budget is exceeded", () => {
    const origTokens = estimateTokens(sampleSkillContext);
    const budget = Math.floor(origTokens * 0.75); // force reduction

    const optimizer = new DefaultTokenOptimizer({ maxTokens: budget });
    const result = optimizer.optimize({ text: sampleSkillContext });

    expect(result.changed).toBe(true);
    expect(result.strategy).toBe("section-priority");
    expect(result.optimizedEstimatedTokens).toBeLessThanOrEqual(budget);
    expect(result.metrics.tokensSaved).toBeGreaterThan(0);
    expect(result.metrics.reductionRatio).toBeGreaterThan(0);
  });

  it("Protected Sections: Rules, Workflow, and Anti-Patterns are NEVER removed", () => {
    // Force a very aggressive reduction budget
    const optimizer = new DefaultTokenOptimizer({ maxTokens: 30 });
    const result = optimizer.optimize({ text: sampleSkillContext });

    // Rules must be present
    expect(result.text).toContain("#### Rules");
    expect(result.text).toContain("- Always clean up effects");
    expect(result.text).toContain("- Never mutate state directly");

    // Workflow must be present
    expect(result.text).toContain("#### Workflow");
    expect(result.text).toContain("- 1. Identify state ownership");

    // Anti-Patterns must be present
    expect(result.text).toContain("#### Anti-Patterns");
    expect(result.text).toContain("- Index as key in dynamic lists");
  });

  it("Examples: lower-priority examples are removed before critical sections", () => {
    const origTokens = estimateTokens(sampleSkillContext);
    // Moderate budget that drops redundant examples
    const optimizer = new DefaultTokenOptimizer({ maxTokens: origTokens - 35 });
    const result = optimizer.optimize({ text: sampleSkillContext });

    // React's second example should be dropped first
    expect(result.text).toContain("Good Example");
    expect(result.text).not.toContain("Another Example");

    // Rules and workflow are still intact
    expect(result.text).toContain("Always clean up effects");
  });

  it("Determinism: same input produces identical result and metrics", () => {
    const optimizer = new DefaultTokenOptimizer({ maxTokens: 150 });
    const res1 = optimizer.optimize({ text: sampleSkillContext });
    const res2 = optimizer.optimize({ text: sampleSkillContext });

    expect(res1.text).toBe(res2.text);
    expect(res1.optimizedEstimatedTokens).toBe(res2.optimizedEstimatedTokens);
    expect(res1.metrics).toEqual(res2.metrics);
  });

  it("Metrics: accurately reports original, optimized, saved, and reduction ratio", () => {
    const origTokens = estimateTokens(sampleSkillContext);
    const targetBudget = Math.floor(origTokens * 0.6);
    const optimizer = new DefaultTokenOptimizer({ maxTokens: targetBudget });
    const result = optimizer.optimize({ text: sampleSkillContext });

    expect(result.originalEstimatedTokens).toBe(origTokens);
    expect(result.optimizedEstimatedTokens).toBe(estimateTokens(result.text));
    expect(result.metrics.tokensSaved).toBe(origTokens - result.optimizedEstimatedTokens);
    expect(result.metrics.reductionRatio).toBeCloseTo(
      result.metrics.tokensSaved / origTokens,
      4
    );
  });

  it("Disabled: returns original context unchanged when enabled=false", () => {
    const optimizer = new DefaultTokenOptimizer({ maxTokens: 50, enabled: false });
    const result = optimizer.optimize({ text: sampleSkillContext });

    expect(result.changed).toBe(false);
    expect(result.strategy).toBe("disabled");
    expect(result.text).toBe(sampleSkillContext);
    expect(result.metrics.tokensSaved).toBe(0);
  });

  it("Empty: safely handles empty input", () => {
    const optimizer = new DefaultTokenOptimizer({ maxTokens: 100 });
    const result = optimizer.optimize({ text: "" });

    expect(result.text).toBe("");
    expect(result.originalEstimatedTokens).toBe(0);
    expect(result.optimizedEstimatedTokens).toBe(0);
    expect(result.changed).toBe(false);
    expect(result.strategy).toBe("none");
  });

  it("Small Budget: fails safely without throwing or corrupting markdown", () => {
    const optimizer = new DefaultTokenOptimizer({ maxTokens: 5 });
    const result = optimizer.optimize({ text: sampleSkillContext });

    expect(result.changed).toBe(true);
    expect(result.text).toContain("### Skill: react");
    // Preserves critical rules even when budget is impossibly tiny
    expect(result.text).toContain("Always clean up effects");
  });

  it("Generic Text: reduces paragraph by paragraph when skill syntax is not present", () => {
    const genericText = `Paragraph 1: Introduction to frontend architecture.

Paragraph 2: Detailed discussion on state management and reactivity.

Paragraph 3: Practical steps for component refactoring and styling.

Paragraph 4: Conclusion and summary of design principles.`;

    const origTokens = estimateTokens(genericText);
    const optimizer = new DefaultTokenOptimizer({ maxTokens: origTokens - 20 });
    const result = optimizer.optimize({ text: genericText });

    expect(result.changed).toBe(true);
    expect(result.strategy).toBe("budget-enforcement");
    expect(result.text).toContain("Paragraph 1");
    expect(result.text).not.toContain("Paragraph 4");
  });
});

describe("TokenOptimizer Runtime Integration", () => {
  const dummySkill: Skill = {
    name: "react",
    version: "1.0.0",
    category: "framework",
    description: "React guidelines",
    instructions: ["Use hooks properly"],
    rules: ["Rules: Always clean up effects"],
    examples: [
      { title: "Ex1", example: "const a = 1;" },
      { title: "Ex2", example: "const b = 2;" }
    ]
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

  it("AgentRuntime passes formatted skill context through TokenOptimizer", async () => {
    const provider = new MockModelProvider();
    let optimizerCalled = false;

    const customOptimizer: TokenOptimizer = {
      optimize: (input: TokenOptimizationInput): TokenOptimizationResult => {
        optimizerCalled = true;
        return {
          text: `${input.text}\n<!-- OPTIMIZED -->`,
          originalEstimatedTokens: estimateTokens(input.text),
          optimizedEstimatedTokens: estimateTokens(input.text) + 5,
          changed: true,
          strategy: "custom-test",
          metrics: {
            originalTokens: estimateTokens(input.text),
            optimizedTokens: estimateTokens(input.text) + 5,
            tokensSaved: 0,
            reductionRatio: 0,
            strategy: "custom-test"
          }
        };
      }
    };

    const runtime = new AgentRuntime(provider, {
      skillRegistry: registry,
      activationPolicy: policy as unknown as import("../skills/activation.js").SkillActivationPolicy,
      tokenOptimizer: customOptimizer
    });

    const events: AgentEvent[] = [];
    for await (const event of runtime.run({ message: "Build component", cwd: "/test" })) {
      events.push(event);
    }

    expect(optimizerCalled).toBe(true);
    expect(provider.capturedRequests).toHaveLength(1);
    expect(provider.capturedRequests[0].system).toContain("<!-- OPTIMIZED -->");
  });

  it("Per-Turn: Token optimization is recalculated independently per turn", async () => {
    const provider = new MockModelProvider();
    let turnCount = 0;

    const customOptimizer: TokenOptimizer = {
      optimize: (input: TokenOptimizationInput): TokenOptimizationResult => {
        turnCount++;
        return {
          text: `${input.text}\n<!-- TURN_${turnCount} -->`,
          originalEstimatedTokens: estimateTokens(input.text),
          optimizedEstimatedTokens: estimateTokens(input.text),
          changed: true,
          strategy: "custom-turn",
          metrics: {
            originalTokens: estimateTokens(input.text),
            optimizedTokens: estimateTokens(input.text),
            tokensSaved: 0,
            reductionRatio: 0,
            strategy: "custom-turn"
          }
        };
      }
    };

    const runtime = new AgentRuntime(provider, {
      skillRegistry: registry,
      activationPolicy: policy as unknown as import("../skills/activation.js").SkillActivationPolicy,
      tokenOptimizer: customOptimizer
    });

    // Turn 1
    for await (const event of runtime.run({ message: "Turn 1", cwd: "/test" })) {
      void event;
    }
    // Turn 2
    for await (const event of runtime.run({ message: "Turn 2", cwd: "/test" })) {
      void event;
    }

    expect(turnCount).toBe(2);
    expect(provider.capturedRequests[0].system).toContain("<!-- TURN_1 -->");
    expect(provider.capturedRequests[0].system).not.toContain("<!-- TURN_2 -->");
    expect(provider.capturedRequests[1].system).toContain("<!-- TURN_2 -->");
    expect(provider.capturedRequests[1].system).not.toContain("<!-- TURN_1 -->");
  });

  it("Provider Independence: Provider receives identical string regardless of model ID", async () => {
    const providerA = new MockModelProvider();
    providerA.id = "openai:gpt-4o";
    const providerB = new MockModelProvider();
    providerB.id = "gemini:gemini-1.5-pro";
    const providerC = new MockModelProvider();
    providerC.id = "ollama:llama3";

    const optimizer = new DefaultTokenOptimizer({ maxTokens: 1000 });

    const runtimeA = new AgentRuntime(providerA, {
      skillRegistry: registry,
      activationPolicy: policy as unknown as import("../skills/activation.js").SkillActivationPolicy,
      tokenOptimizer: optimizer
    });
    const runtimeB = new AgentRuntime(providerB, {
      skillRegistry: registry,
      activationPolicy: policy as unknown as import("../skills/activation.js").SkillActivationPolicy,
      tokenOptimizer: optimizer
    });
    const runtimeC = new AgentRuntime(providerC, {
      skillRegistry: registry,
      activationPolicy: policy as unknown as import("../skills/activation.js").SkillActivationPolicy,
      tokenOptimizer: optimizer
    });

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
});
