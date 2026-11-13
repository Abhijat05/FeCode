import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { resolveActiveConfiguration, hasExplicitEnvConfig } from "./configResolver.js";
import { ProviderProfileStore } from "./profileStore.js";
import { InMemoryCredentialStore } from "./credentialStore.js";

describe("Configuration Resolution and Precedence", () => {
  let tmpDir: string;
  let testFilePath: string;
  let credentialStore: InMemoryCredentialStore;
  let profileStore: ProviderProfileStore;

  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    delete process.env.FE_PROVIDER;
    delete process.env.FE_MODEL;
    delete process.env.GEMINI_API_KEY;
    delete process.env.FE_GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.FE_OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.FE_ANTHROPIC_API_KEY;
    delete process.env.OPENAI_COMPATIBLE_API_KEY;
    delete process.env.FE_OPENAI_COMPATIBLE_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.FE_OPENAI_BASE_URL;

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-res-test-"));
    testFilePath = path.join(tmpDir, "providers.json");
    credentialStore = new InMemoryCredentialStore();
    profileStore = new ProviderProfileStore(testFilePath, credentialStore);
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("Precedence 1: Explicit environment configuration wins over saved profiles", async () => {
    // 1. Save a profile in the store
    await profileStore.saveProfile({
      providerId: "openai",
      displayName: "OpenAI Saved Profile",
      model: "gpt-4o",
      apiKey: "sk-saved-openai-key"
    });

    // 2. Set explicit environment variables for Gemini
    process.env.FE_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "AIzaSy-explicit-gemini-key";
    process.env.FE_MODEL = "gemini-2.5-pro";

    expect(hasExplicitEnvConfig(process.env)).toBe(true);

    const resolved = await resolveActiveConfiguration({
      cwd: tmpDir,
      profileStore,
      credentialStore
    });

    expect(resolved.source).toBe("environment");
    expect(resolved.provider).toBe("gemini");
    expect(resolved.model).toBe("gemini-2.5-pro");
    expect(resolved.apiKey).toBe("AIzaSy-explicit-gemini-key");
    expect(resolved.needsOnboarding).toBe(false);
    expect(resolved.explicitEnvError).toBeUndefined();
  });

  it("Precedence 1: Invalid explicit environment configuration fails clearly rather than falling back to saved profile", async () => {
    // Save a valid profile
    await profileStore.saveProfile({
      providerId: "openai",
      displayName: "OpenAI Saved Profile",
      model: "gpt-4o",
      apiKey: "sk-saved-key"
    });

    // Explicitly set FE_PROVIDER=gemini without setting GEMINI_API_KEY
    process.env.FE_PROVIDER = "gemini";
    delete process.env.GEMINI_API_KEY;
    delete process.env.FE_GEMINI_API_KEY;

    expect(hasExplicitEnvConfig(process.env)).toBe(true);

    const resolved = await resolveActiveConfiguration({
      cwd: tmpDir,
      profileStore,
      credentialStore
    });

    expect(resolved.source).toBe("environment");
    expect(resolved.needsOnboarding).toBe(false);
    expect(resolved.explicitEnvError).toContain("GEMINI_API_KEY is not configured");
  });

  it("Precedence 2: Active saved profile is used when no explicit environment configuration exists", async () => {
    // No explicit env vars
    expect(hasExplicitEnvConfig(process.env)).toBe(false);

    // Save profile with encrypted credential
    const saved = await profileStore.saveProfile({
      providerId: "openai-compatible",
      displayName: "NVIDIA NIM DeepSeek",
      model: "deepseek-ai/deepseek-v4.1-flash",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKey: "nvapi-secret-key-12345"
    });

    const resolved = await resolveActiveConfiguration({
      cwd: tmpDir,
      profileStore,
      credentialStore
    });

    expect(resolved.source).toBe("profile");
    expect(resolved.provider).toBe("openai-compatible");
    expect(resolved.model).toBe("deepseek-ai/deepseek-v4.1-flash");
    expect(resolved.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(resolved.apiKey).toBe("nvapi-secret-key-12345");
    expect(resolved.activeProfile?.id).toBe(saved.id);
    expect(resolved.needsOnboarding).toBe(false);
  });

  it("Precedence 3: First-run onboarding is triggered when neither explicit env vars nor saved profiles exist", async () => {
    expect(hasExplicitEnvConfig(process.env)).toBe(false);

    const resolved = await resolveActiveConfiguration({
      cwd: tmpDir,
      profileStore,
      credentialStore
    });

    expect(resolved.source).toBe("none");
    expect(resolved.needsOnboarding).toBe(true);
    expect(resolved.explicitEnvError).toBeUndefined();
  });
});
