import { describe, it, expect } from "vitest";
import { runBenchmark, createBenchmarkFixtures } from "./benchmark.js";

describe("TokenOptimizer Benchmark", () => {
  it("executes comparison benchmark across Small, Medium, Large, Maximum fixtures", () => {
    const results = runBenchmark();

    expect(results).toHaveLength(8); // 4 fixtures * 2 optimizers

    const fixtures = ["Small", "Medium", "Large", "Maximum"] as const;
    for (const f of fixtures) {
      const defaultRes = results.find(r => r.fixture === f && r.optimizer === "Default");
      const ponytailRes = results.find(r => r.fixture === f && r.optimizer === "Ponytail");

      expect(defaultRes).toBeDefined();
      expect(ponytailRes).toBeDefined();

      expect(defaultRes!.protectedContentValid).toBe(true);
      expect(ponytailRes!.protectedContentValid).toBe(true);
      expect(defaultRes!.outputTokens).toBeLessThanOrEqual(6000);
      expect(ponytailRes!.outputTokens).toBeLessThanOrEqual(6000);
    }

    // On Maximum fixture (>6000 tokens), both optimizers must reduce tokens
    const maxDefault = results.find(r => r.fixture === "Maximum" && r.optimizer === "Default")!;
    const maxPonytail = results.find(r => r.fixture === "Maximum" && r.optimizer === "Ponytail")!;

    expect(maxDefault.tokensSaved).toBeGreaterThan(0);
    expect(maxPonytail.tokensSaved).toBeGreaterThan(0);
    expect(maxDefault.outputTokens).toBeLessThanOrEqual(6000);
    expect(maxPonytail.outputTokens).toBeLessThanOrEqual(6000);
  });

  it("Benchmark fixtures accurately reflect progressive sizes", () => {
    const fixtures = createBenchmarkFixtures();

    expect(fixtures.Small.length).toBeLessThan(fixtures.Medium.length);
    expect(fixtures.Medium.length).toBeLessThan(fixtures.Large.length);
    expect(fixtures.Large.length).toBeLessThan(fixtures.Maximum.length);
  });
});
