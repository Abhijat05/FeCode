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
    expect(config.provider).toBe("gemini");
    expect(config.model).toBe("gemini-2.5-flash");
    expect(config.ollamaBaseUrl).toBe("http://localhost:11434/v1");
    expect(config.openaiApiKey).toBeUndefined();
    expect(config.geminiApiKey).toBeUndefined();
    expect(config.fallback?.enabled).toBe(false);
  });

  it("parses fallback configuration when FE_AUTO_FALLBACK is enabled", () => {
    process.env.FE_AUTO_FALLBACK = "true";
    process.env.FE_FALLBACK_PROVIDERS = "gemini, openai, ollama";
    process.env.FE_MAX_RETRIES_PER_PROVIDER = "2";
    process.env.FE_MAX_FALLBACK_SWITCHES = "3";

    const config = loadConfig({ cwd: tmpDir });
    expect(config.fallback?.enabled).toBe(true);
    expect(config.fallback?.providers).toEqual(["gemini", "openai", "ollama"]);
    expect(config.fallback?.maxRetriesPerProvider).toBe(2);
    expect(config.fallback?.maxTotalFallbackSwitches).toBe(3);
  });

  it("parses OPENAI_BASE_URL and openai-compatible provider configuration", () => {
    process.env.FE_PROVIDER = "openai-compatible";
    process.env.FE_MODEL = "deepseek-ai/deepseek-v4.1-flash";
    process.env.OPENAI_API_KEY = "nvapi-test-key-12345";
    process.env.OPENAI_BASE_URL = "https://integrate.api.nvidia.com/v1";

    const config = loadConfig({ cwd: tmpDir });
    expect(config.provider).toBe("openai-compatible");
    expect(config.model).toBe("deepseek-ai/deepseek-v4.1-flash");
    expect(config.openaiApiKey).toBe("nvapi-test-key-12345");
    expect(config.openaiBaseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(config.openaiCompatibleApiKey).toBe("nvapi-test-key-12345");
  });

  it("supports separate OPENAI_COMPATIBLE_API_KEY when specified", () => {
    process.env.FE_PROVIDER = "openai-compatible";
    process.env.OPENAI_API_KEY = "sk-openai-primary";
    process.env.OPENAI_COMPATIBLE_API_KEY = "nvapi-separate-key";
    process.env.OPENAI_BASE_URL = "https://integrate.api.nvidia.com/v1";

    const config = loadConfig({ cwd: tmpDir });
    expect(config.openaiApiKey).toBe("sk-openai-primary");
    expect(config.openaiCompatibleApiKey).toBe("nvapi-separate-key");
    expect(config.openaiBaseUrl).toBe("https://integrate.api.nvidia.com/v1");
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

    const maskedEight = maskSecret("12345678");
    expect(maskedEight).toBe("[SET]");
  });
});
