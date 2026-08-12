import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { loadConfig, maskSecret } from "./config.js";

describe("loadConfig", () => {
  let tmpDir: string;
  const originalEnv = process.env;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-config-test-"));
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("loads .env values from specified working directory", async () => {
    delete process.env.FE_PROVIDER;
    delete process.env.FE_MODEL;
    delete process.env.GEMINI_API_KEY;

    await fs.writeFile(
      path.join(tmpDir, ".env"),
      "FE_PROVIDER=gemini\nFE_MODEL=gemini-2.5-flash\nGEMINI_API_KEY=test-gemini-key-123\n"
    );

    const config = loadConfig({ cwd: tmpDir });
    expect(config.provider).toBe("gemini");
    expect(config.model).toBe("gemini-2.5-flash");
    expect(config.geminiApiKey).toBe("test-gemini-key-123");
  });

  it("ensures existing process.env values take precedence over .env file values", async () => {
    process.env.FE_PROVIDER = "openai";
    process.env.FE_MODEL = "gpt-4o-mini";
    delete process.env.OPENAI_API_KEY;

    await fs.writeFile(
      path.join(tmpDir, ".env"),
      "FE_PROVIDER=gemini\nFE_MODEL=gemini-2.5-flash\nOPENAI_API_KEY=env-file-key\n"
    );

    const config = loadConfig({ cwd: tmpDir });
    expect(config.provider).toBe("openai");
    expect(config.model).toBe("gpt-4o-mini");
    expect(config.openaiApiKey).toBe("env-file-key");
  });

  it("handles missing optional values with sensible defaults", () => {
    delete process.env.FE_PROVIDER;
    delete process.env.FE_MODEL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OLLAMA_BASE_URL;

    const config = loadConfig({ cwd: tmpDir });
    expect(config.provider).toBe("openai");
    expect(config.model).toBe("gpt-4o");
    expect(config.ollamaBaseUrl).toBe("http://localhost:11434");
    expect(config.openaiApiKey).toBeUndefined();
    expect(config.geminiApiKey).toBeUndefined();
  });
});

describe("maskSecret", () => {
  it("never prints complete secret string", () => {
    expect(maskSecret(undefined)).toBe("[NOT SET]");
    expect(maskSecret("")).toBe("[NOT SET]");

    const masked1 = maskSecret("AIzaSy1234567890abcdef");
    expect(masked1).not.toContain("AIzaSy1234567890abcdef");
    expect(masked1).toContain("AIza...");

    const maskedShort = maskSecret("abc");
    expect(maskedShort).toBe("[SET]");
  });
});
