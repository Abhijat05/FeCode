import { describe, it, expect } from "vitest";
import type { ID } from "./index.js";

describe("@fecode/shared", () => {
  it("defines ID type correctly", () => {
    const id: ID = "test-id-123";
    expect(id).toBe("test-id-123");
  });
});
