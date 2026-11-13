import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { safeJsonParse } from "@fecode/shared";
import type {
  StoredProviderProfile,
  ProviderProfilesData,
  CredentialStore
} from "./types.js";
import { createDefaultCredentialStore } from "./credentialStore.js";

export function getDefaultProvidersFilePath(): string {
  if (process.env.FECODE_PROVIDERS_FILE) {
    return path.resolve(process.env.FECODE_PROVIDERS_FILE);
  }
  return path.join(os.homedir(), ".fecode", "providers.json");
}

export interface SaveProfileInput {
  id?: string;
  providerId: string;
  displayName: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

export class ProviderProfileStore {
  private readonly filePath: string;
  private readonly credentialStore: CredentialStore;

  constructor(filePath?: string, credentialStore?: CredentialStore) {
    this.filePath = filePath || getDefaultProvidersFilePath();
    this.credentialStore = credentialStore || createDefaultCredentialStore();
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public getCredentialStore(): CredentialStore {
    return this.credentialStore;
  }

  private async loadData(): Promise<ProviderProfilesData> {
    try {
      const content = await fs.readFile(this.filePath, "utf-8");
      const parsed = safeJsonParse<ProviderProfilesData>(content);
      if (parsed && Array.isArray(parsed.profiles)) {
        return parsed;
      }
    } catch {
      // File missing or unreadable -> return clean initial state
    }
    return {
      version: 1,
      profiles: []
    };
  }

  private async saveData(data: ProviderProfilesData): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });

    const content = JSON.stringify(data, null, 2);
    const tmpPath = `${this.filePath}.tmp.${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    await fs.writeFile(tmpPath, content, { encoding: "utf-8", mode: 0o600 });
    try {
      await fs.rename(tmpPath, this.filePath);
    } catch {
      // On Windows rename over existing file can fail if locked; fallback to copy/overwrite
      await fs.copyFile(tmpPath, this.filePath);
      await fs.rm(tmpPath, { force: true }).catch(() => {});
    }
  }

  public async getProfiles(): Promise<StoredProviderProfile[]> {
    const data = await this.loadData();
    return data.profiles;
  }

  public async getProfile(id: string): Promise<StoredProviderProfile | null> {
    if (!id) return null;
    const data = await this.loadData();
    return data.profiles.find((p) => p.id === id) || null;
  }

  public async getActiveProfile(): Promise<StoredProviderProfile | null> {
    const data = await this.loadData();
    if (!data.activeProfileId) return null;
    return data.profiles.find((p) => p.id === data.activeProfileId) || null;
  }

  public async setActiveProfile(id: string): Promise<void> {
    const data = await this.loadData();
    const profile = data.profiles.find((p) => p.id === id);
    if (!profile) {
      throw new Error(`Profile with ID "${id}" does not exist.`);
    }
    data.activeProfileId = id;
    await this.saveData(data);
  }

  public async saveProfile(input: SaveProfileInput): Promise<StoredProviderProfile> {
    const providerId = input.providerId.trim().toLowerCase();
    const displayName = input.displayName.trim();
    const model = input.model.trim();
    const baseUrl = input.baseUrl ? input.baseUrl.trim() : undefined;

    if (!providerId) {
      throw new Error("Provider ID is required.");
    }
    if (!displayName) {
      throw new Error("Display name is required.");
    }
    if (!model) {
      throw new Error("Model is required.");
    }

    const data = await this.loadData();
    const now = new Date().toISOString();

    let profileId = input.id ? input.id.trim() : "";
    let existingIndex = -1;

    if (profileId) {
      existingIndex = data.profiles.findIndex((p) => p.id === profileId);
    } else {
      // Generate stable, collision-free profile ID
      const rand = Math.random().toString(36).substring(2, 8);
      profileId = `prof-${providerId}-${Date.now().toString(36)}-${rand}`;
    }

    const credentialRef = `fecode:profile:${profileId}`;

    // Store API key securely in OS Credential Store if provided
    if (input.apiKey && input.apiKey.trim()) {
      await this.credentialStore.set(credentialRef, input.apiKey.trim());
    }

    const storedProfile: StoredProviderProfile = {
      id: profileId,
      providerId,
      displayName,
      model,
      baseUrl: baseUrl || undefined,
      credentialReference: input.apiKey !== undefined ? credentialRef : (existingIndex >= 0 ? data.profiles[existingIndex].credentialReference : undefined),
      createdAt: existingIndex >= 0 ? data.profiles[existingIndex].createdAt : now,
      updatedAt: now
    };

    if (existingIndex >= 0) {
      data.profiles[existingIndex] = storedProfile;
    } else {
      data.profiles.push(storedProfile);
    }

    // If this is the only profile, automatically activate it
    if (!data.activeProfileId || data.profiles.length === 1) {
      data.activeProfileId = profileId;
    }

    await this.saveData(data);
    return storedProfile;
  }

  public async deleteProfile(id: string): Promise<void> {
    const data = await this.loadData();
    const profile = data.profiles.find((p) => p.id === id);
    if (!profile) return;

    // Clean up OS credential store reference
    if (profile.credentialReference) {
      try {
        await this.credentialStore.delete(profile.credentialReference);
      } catch {
        // Ignore failure during deletion cleanup
      }
    }

    data.profiles = data.profiles.filter((p) => p.id !== id);

    if (data.activeProfileId === id) {
      data.activeProfileId = data.profiles.length > 0 ? data.profiles[0].id : undefined;
    }

    await this.saveData(data);
  }

  public async getResolvedProfile(
    id: string
  ): Promise<{ profile: StoredProviderProfile; apiKey?: string } | null> {
    const profile = await this.getProfile(id);
    if (!profile) return null;

    let apiKey: string | undefined;
    if (profile.credentialReference) {
      const retrieved = await this.credentialStore.get(profile.credentialReference);
      if (retrieved) {
        apiKey = retrieved;
      }
    }

    return {
      profile,
      apiKey
    };
  }
}
