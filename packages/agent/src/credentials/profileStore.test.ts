import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { ProviderProfileStore } from "./profileStore.js";
import { InMemoryCredentialStore } from "./credentialStore.js";

describe("ProviderProfileStore", () => {
  let tmpDir: string;
  let testFilePath: string;
  let credentialStore: InMemoryCredentialStore;
  let profileStore: ProviderProfileStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-prof-test-"));
    testFilePath = path.join(tmpDir, "providers.json");
    credentialStore = new InMemoryCredentialStore();
    profileStore = new ProviderProfileStore(testFilePath, credentialStore);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("creates a new provider profile and stores credentials in the credential store", async () => {
    const rawApiKey = "sk-test-secret-key-123456789";
    const profile = await profileStore.saveProfile({
      providerId: "gemini",
      displayName: "Google Gemini Flash",
      model: "gemini-2.5-flash",
      apiKey: rawApiKey
    });

    expect(profile.id).toBeDefined();
    expect(profile.providerId).toBe("gemini");
    expect(profile.displayName).toBe("Google Gemini Flash");
    expect(profile.model).toBe("gemini-2.5-flash");
    expect(profile.credentialReference).toBe(`fecode:profile:${profile.id}`);
    expect(profile.createdAt).toBeDefined();

    // The API key is in the credential store
    const storedSecret = await credentialStore.get(profile.credentialReference!);
    expect(storedSecret).toBe(rawApiKey);

    // CRITICAL SECURITY INVARIANT: The JSON file must NEVER contain the plaintext API key!
    const fileContent = await fs.readFile(testFilePath, "utf-8");
    expect(fileContent).not.toContain(rawApiKey);
    expect(fileContent).toContain(profile.credentialReference);

    // Profile list reflects the new profile
    const profiles = await profileStore.getProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe(profile.id);

    // First saved profile is automatically marked active
    const active = await profileStore.getActiveProfile();
    expect(active?.id).toBe(profile.id);
  });

  it("updates an existing profile without creating duplicate IDs", async () => {
    const profile = await profileStore.saveProfile({
      providerId: "openai",
      displayName: "OpenAI GPT-4o",
      model: "gpt-4o",
      apiKey: "sk-initial-key-111111"
    });

    const initialId = profile.id;
    const initialCreatedAt = profile.createdAt;

    // Update model and API key
    const updated = await profileStore.saveProfile({
      id: initialId,
      providerId: "openai",
      displayName: "OpenAI GPT-4o Mini",
      model: "gpt-4o-mini",
      apiKey: "sk-updated-key-222222"
    });

    expect(updated.id).toBe(initialId);
    expect(updated.model).toBe("gpt-4o-mini");
    expect(updated.createdAt).toBe(initialCreatedAt);

    const profiles = await profileStore.getProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].model).toBe("gpt-4o-mini");

    const resolved = await profileStore.getResolvedProfile(initialId);
    expect(resolved?.apiKey).toBe("sk-updated-key-222222");
  });

  it("deletes a profile and cleans up its associated credential safely", async () => {
    const profA = await profileStore.saveProfile({
      providerId: "gemini",
      displayName: "Gemini A",
      model: "gemini-2.5-flash",
      apiKey: "key-a"
    });
    const profB = await profileStore.saveProfile({
      providerId: "openai",
      displayName: "OpenAI B",
      model: "gpt-4o",
      apiKey: "key-b"
    });

    expect(await profileStore.getProfiles()).toHaveLength(2);

    // Delete profile A
    await profileStore.deleteProfile(profA.id);

    // Profile A is gone
    const profilesAfter = await profileStore.getProfiles();
    expect(profilesAfter).toHaveLength(1);
    expect(profilesAfter[0].id).toBe(profB.id);

    // Credential for A is deleted
    expect(await credentialStore.get(profA.credentialReference!)).toBeNull();

    // Credential for B remains untouched!
    expect(await credentialStore.get(profB.credentialReference!)).toBe("key-b");
  });

  it("activates a selected profile", async () => {
    const p1 = await profileStore.saveProfile({
      providerId: "gemini",
      displayName: "Gemini",
      model: "gemini-2.5-flash",
      apiKey: "k1"
    });
    const p2 = await profileStore.saveProfile({
      providerId: "ollama",
      displayName: "Ollama Local",
      model: "qwen2.5-coder",
      baseUrl: "http://localhost:11434/v1"
    });

    expect((await profileStore.getActiveProfile())?.id).toBe(p1.id);

    await profileStore.setActiveProfile(p2.id);
    expect((await profileStore.getActiveProfile())?.id).toBe(p2.id);
  });

  it("throws clear error when activating a non-existent profile", async () => {
    await expect(profileStore.setActiveProfile("non-existent-id")).rejects.toThrow(
      'Profile with ID "non-existent-id" does not exist.'
    );
  });

  it("validates required configuration fields on save", async () => {
    await expect(
      profileStore.saveProfile({
        providerId: "",
        displayName: "Test",
        model: "gpt-4o"
      })
    ).rejects.toThrow("Provider ID is required.");

    await expect(
      profileStore.saveProfile({
        providerId: "openai",
        displayName: "",
        model: "gpt-4o"
      })
    ).rejects.toThrow("Display name is required.");

    await expect(
      profileStore.saveProfile({
        providerId: "openai",
        displayName: "Test",
        model: ""
      })
    ).rejects.toThrow("Model is required.");
  });

  it("supports Ollama without requiring an API key", async () => {
    const profile = await profileStore.saveProfile({
      providerId: "ollama",
      displayName: "Ollama Local Qwen",
      model: "qwen2.5-coder",
      baseUrl: "http://localhost:11434/v1"
    });

    expect(profile.credentialReference).toBeUndefined();
    const resolved = await profileStore.getResolvedProfile(profile.id);
    expect(resolved?.profile.providerId).toBe("ollama");
    expect(resolved?.apiKey).toBeUndefined();
  });
});
