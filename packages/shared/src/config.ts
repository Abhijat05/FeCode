import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

export interface FeCodeConfig {
  provider: string;
  model: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  ollamaBaseUrl?: string;
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

  const provider = process.env.FE_PROVIDER || "openai";
  const defaultModel =
    provider === "gemini"
      ? "gemini-2.5-flash"
      : provider === "ollama"
        ? "qwen2.5-coder"
        : "gpt-4o";

  const model = process.env.FE_MODEL || defaultModel;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

  return {
    provider,
    model,
    openaiApiKey,
    geminiApiKey,
    ollamaBaseUrl
  };
}

export function maskSecret(secret?: string): string {
  if (!secret) {
    return "[NOT SET]";
  }

  if (secret.length <= 6) {
    return "[SET]";
  }

  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}
