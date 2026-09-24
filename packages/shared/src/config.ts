import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

export interface ProviderFallbackConfig {
  enabled: boolean;
  providers?: string[];
  maxRetriesPerProvider?: number;
  maxTotalFallbackSwitches?: number;
}

export interface FeCodeConfig {
  provider: string;
  model: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  ollamaBaseUrl?: string;
  fallback?: ProviderFallbackConfig;
}

export interface LoadConfigOptions {
  cwd?: string;
  envFile?: string;
}

export function findRootEnvFile(startDir: string): string | undefined {
  let currentDir = path.resolve(startDir);

  while (true) {
    const candidate = path.join(currentDir, ".env");
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return undefined;
}

export function loadConfig(options: LoadConfigOptions = {}): FeCodeConfig {
  const startDir = options.cwd || process.cwd();
  const envPath = options.envFile
    ? path.resolve(options.envFile)
    : findRootEnvFile(startDir);

  if (envPath && fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }

  const provider = process.env.FE_PROVIDER || "gemini";
  const defaultModel =
    provider === "gemini"
      ? "gemini-2.5-flash"
      : provider === "ollama"
        ? "qwen2.5-coder"
        : "gpt-4o";

  const model = process.env.FE_MODEL || defaultModel;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const ollamaBaseUrl =
    process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";

  const autoFallback = process.env.FE_AUTO_FALLBACK === "true";
  const fallbackProvidersEnv = process.env.FE_FALLBACK_PROVIDERS;
  const fallbackProviders = fallbackProvidersEnv
    ? fallbackProvidersEnv.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean)
    : undefined;

  const maxRetriesEnv = process.env.FE_MAX_RETRIES_PER_PROVIDER;
  const parsedMaxRetries = maxRetriesEnv ? parseInt(maxRetriesEnv, 10) : 1;

  const maxSwitchesEnv = process.env.FE_MAX_FALLBACK_SWITCHES;
  const parsedMaxSwitches = maxSwitchesEnv ? parseInt(maxSwitchesEnv, 10) : 2;

  const fallback: ProviderFallbackConfig = {
    enabled: autoFallback,
    providers: fallbackProviders,
    maxRetriesPerProvider: Number.isFinite(parsedMaxRetries) ? parsedMaxRetries : 1,
    maxTotalFallbackSwitches: Number.isFinite(parsedMaxSwitches) ? parsedMaxSwitches : 2
  };

  return {
    provider,
    model,
    openaiApiKey,
    geminiApiKey,
    ollamaBaseUrl,
    fallback
  };
}

export function maskSecret(secret?: string): string {
  if (!secret) {
    return "[NOT SET]";
  }

  if (secret.length <= 8) {
    return "[SET]";
  }

  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}
