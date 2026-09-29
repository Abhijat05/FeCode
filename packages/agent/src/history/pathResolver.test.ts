import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "path";
import * as os from "os";
import { getDefaultHistoryDir } from "./pathResolver.js";

describe("History path resolver", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.FECODE_HISTORY_DIR;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns custom directory when FECODE_HISTORY_DIR is explicitly configured", () => {
    process.env.FECODE_HISTORY_DIR = "/custom/history/path";
    expect(getDefaultHistoryDir()).toBe(path.resolve("/custom/history/path"));
  });

  it("sandboxes history directory to a temporary path under test runner environment", () => {
    delete process.env.FECODE_HISTORY_DIR;
    process.env.VITEST = "true";
    const dir = getDefaultHistoryDir();
    expect(dir).toBe(path.join(os.tmpdir(), "fecode-test-history"));
    expect(dir).not.toBe(path.join(os.homedir(), ".fecode", "history"));
  });

  it("falls back to user home directory when outside test environments and unconfigured", () => {
    delete process.env.FECODE_HISTORY_DIR;
    delete process.env.VITEST;
    const oldNodeEnv = process.env.NODE_ENV;
    delete process.env.NODE_ENV;

    const dir = getDefaultHistoryDir();
    expect(dir).toBe(path.join(os.homedir(), ".fecode", "history"));

    process.env.NODE_ENV = oldNodeEnv;
  });
});
