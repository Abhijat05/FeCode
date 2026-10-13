import { describe, it, expect } from "vitest";
import { safeJsonStringify, safeJsonClone } from "./safeJson.js";

describe("safeJson", () => {
  describe("safeJsonStringify", () => {
    it("serializes normal objects and primitives identically to JSON.stringify", () => {
      const obj = { a: 1, b: "hello", c: true, d: null, e: [1, 2, 3] };
      expect(safeJsonStringify(obj)).toBe(JSON.stringify(obj));
    });

    it("serializes BigInt values without throwing TypeError", () => {
      const obj = { big: 9007199254740991n, regular: 42 };
      expect(() => JSON.stringify(obj)).toThrow(); // Standard JSON.stringify fails

      const result = safeJsonStringify(obj);
      expect(() => JSON.parse(result)).not.toThrow();
      const parsed = JSON.parse(result);
      expect(parsed.big).toBe("9007199254740991");
      expect(parsed.regular).toBe(42);
    });

    it("detects and replaces circular references with [Circular] without throwing", () => {
      const circularObj: Record<string, unknown> = { name: "root" };
      circularObj.self = circularObj;
      const child: Record<string, unknown> = { parent: circularObj };
      circularObj.child = child;

      expect(() => JSON.stringify(circularObj)).toThrow(); // Standard JSON.stringify fails

      const result = safeJsonStringify(circularObj);
      expect(() => JSON.parse(result)).not.toThrow();
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe("root");
      expect(parsed.self).toBe("[Circular]");
      expect(parsed.child.parent).toBe("[Circular]");
    });

    it("serializes Error objects with name and message", () => {
      const err = new Error("Something broke");
      const obj = { error: err };

      const result = safeJsonStringify(obj);
      const parsed = JSON.parse(result);
      expect(parsed.error.name).toBe("Error");
      expect(parsed.error.message).toBe("Something broke");
    });

    it("handles null, undefined, strings, numbers, booleans directly", () => {
      expect(safeJsonStringify(null)).toBe("null");
      expect(safeJsonStringify(undefined)).toBeUndefined();
      expect(safeJsonStringify(123)).toBe("123");
      expect(safeJsonStringify("text")).toBe('"text"');
    });
  });

  describe("safeJsonClone", () => {
    it("clones objects safely while normalizing BigInt and circular structures", () => {
      const circular: Record<string, unknown> = { id: 100n };
      circular.loop = circular;

      const cloned = safeJsonClone(circular);
      expect(cloned.id).toBe("100");
      expect(cloned.loop).toBe("[Circular]");
    });
  });
});
