import { loadConfig } from "@fecode/shared";
import type {
  CredentialStore,
  ResolvedConfiguration
} from "./types.js";
import { ProviderProfileStore } from "./profileStore.js";
import { createDefaultCredentialStore } from "./credentialStore.js";

export function hasExplicitEnvConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.FE_PROVIDER && env.FE_PROVIDER.trim().length > 0) {
    return true;
  }
  if (env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim().length > 0) {
    return true;
  }
  if (env.FE_GEMINI_API_KEY && env.FE_GEMINI_API_KEY.trim().length > 0) {
    return true;
  }
  if (env.OPENAI_API_KEY && env.OPENAI_API_KEY.trim().length > 0) {
    return true;
  }
  if (env.FE_OPENAI_API_KEY && env.FE_OPENAI_API_KEY.trim().length > 0) {
    return true;
  }
  if (env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.trim().length > 0) {
    return true;
  }
  if (env.FE_ANTHROPIC_API_KEY && env.FE_ANTHROPIC_API_KEY.trim().length > 0) {
    return true;
  }
  if (env.OPENAI_COMPATIBLE_API_KEY && env.OPENAI_COMPATIBLE_API_KEY.trim().length > 0) {
    return true;
  }
  if (env.FE_OPENAI_COMPATIBLE_API_KEY && env.FE_OPENAI_COMPATIBLE_API_KEY.trim().length > 0) {
    return true;
  }
  if (env.FE_OPENAI_BASE_URL && env.FE_OPENAI_BASE_URL.trim().length > 0) {
    return true;
  }
  return false;
}

export interface ResolveConfigOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  profileStore?: ProviderProfileStore;
  credentialStore?: CredentialStore;
}

/**
 * Resolves AI provider configuration using the strict 3-tier precedence model:
 * 1. Explicit environment-variable configuration.
 * 2. Active saved provider profile (from OS credential store + providers.json).
 * 3. First-run onboarding when neither exists.
 */
export async function resolveActiveConfiguration(
  options: ResolveConfigOptions = {}
): Promise<ResolvedConfiguration> {
  const env = options.env || process.env;
  const config = loadConfig({ cwd: options.cwd });

  // 1. Explicit Environment Configuration Precedence
  if (hasExplicitEnvConfig(env)) {
    const provider = (env.FE_PROVIDER || config.provider || "gemini").toLowerCase().trim();
    const model = env.FE_MODEL || config.model;

    let apiKey: string | undefined;
    let baseUrl: string | undefined;

    switch (provider) {
      case "gemini":
        apiKey = config.geminiApiKey;
        if (!apiKey) {
          return {
            source: "environment",
            provider,
            model,
            needsOnboarding: false,
            explicitEnvError: "GEMINI_API_KEY is not configured in environment or .env file."
          };
        }
        break;
      case "openai":
        apiKey = config.openaiApiKey;
        baseUrl = config.openaiBaseUrl;
        if (!apiKey) {
          return {
            source: "environment",
            provider,
            model,
            needsOnboarding: false,
            explicitEnvError: "OPENAI_API_KEY is not configured in environment or .env file."
          };
        }
        break;
      case "openai-compatible":
        apiKey = config.openaiCompatibleApiKey;
        baseUrl = config.openaiBaseUrl;
        if (!baseUrl) {
          return {
            source: "environment",
            provider,
            model,
            needsOnboarding: false,
            explicitEnvError: "OpenAI-compatible provider requires OPENAI_BASE_URL to be set."
          };
        }
        break;
      case "anthropic":
        apiKey = config.anthropicApiKey;
        baseUrl = config.openaiBaseUrl;
        if (!apiKey) {
          return {
            source: "environment",
            provider,
            model,
            needsOnboarding: false,
            explicitEnvError: "ANTHROPIC_API_KEY is not configured in environment or .env file."
          };
        }
        break;
      case "ollama":
        baseUrl = config.ollamaBaseUrl;
        break;
      default:
        return {
          source: "environment",
          provider,
          model,
          needsOnboarding: false,
          explicitEnvError: `Unsupported environment provider: ${provider}`
        };
    }

    return {
      source: "environment",
      provider,
      model,
      apiKey,
      baseUrl,
      needsOnboarding: false
    };
  }

  // 2. Active Saved Provider Profile Precedence
  const credentialStore = options.credentialStore || createDefaultCredentialStore();
  const profileStore = options.profileStore || new ProviderProfileStore(undefined, credentialStore);

  const activeProfile = await profileStore.getActiveProfile();
  if (activeProfile) {
    let resolvedKey: string | undefined;
    if (activeProfile.credentialReference) {
      try {
        const retrieved = await credentialStore.get(activeProfile.credentialReference);
        if (retrieved) {
          resolvedKey = retrieved;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          source: "profile",
          provider: activeProfile.providerId,
          model: activeProfile.model,
          activeProfile,
          needsOnboarding: false,
          explicitEnvError: `Failed to retrieve secure credentials for profile "${activeProfile.displayName}": ${msg}`
        };
      }
    }

    // Validate that required key is present for providers that require authentication
    const pid = activeProfile.providerId.toLowerCase().trim();
    if (pid !== "ollama" && !resolvedKey) {
      return {
        source: "profile",
        provider: activeProfile.providerId,
        model: activeProfile.model,
        activeProfile,
        needsOnboarding: false,
        explicitEnvError: `Profile "${activeProfile.displayName}" is missing stored API credentials. Please re-enter credentials.`
      };
    }

    return {
      source: "profile",
      provider: activeProfile.providerId,
      model: activeProfile.model,
      baseUrl: activeProfile.baseUrl,
      apiKey: resolvedKey,
      activeProfile,
      needsOnboarding: false
    };
  }

  // 3. First-Run Onboarding Precedence (neither explicit env config nor saved profile exists)
  return {
    source: "none",
    provider: "gemini",
    model: "gemini-2.5-flash",
    needsOnboarding: true
  };
}
