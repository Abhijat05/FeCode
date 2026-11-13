export interface StoredProviderProfile {
  id: string;
  providerId: string;
  displayName: string;
  model: string;
  baseUrl?: string;
  credentialReference?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderProfilesData {
  version: 1;
  activeProfileId?: string;
  profiles: StoredProviderProfile[];
}

export interface CredentialStore {
  get(reference: string): Promise<string | null>;
  set(reference: string, secret: string): Promise<void>;
  delete(reference: string): Promise<void>;
}

export interface ConnectionTestResult {
  success: boolean;
  providerId: string;
  model: string;
  steps: {
    authentication: "success" | "failed" | "skipped";
    modelAvailable: "success" | "failed" | "skipped";
  };
  durationMs: number;
  message?: string;
  error?: {
    category: string;
    reason: string;
    statusCode?: number;
  };
}

export type ConfigSource = "environment" | "profile" | "none";

export interface ResolvedConfiguration {
  source: ConfigSource;
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  activeProfile?: StoredProviderProfile;
  needsOnboarding: boolean;
  explicitEnvError?: string;
}
