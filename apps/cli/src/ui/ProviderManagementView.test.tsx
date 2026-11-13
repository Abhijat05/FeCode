import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { ProviderManagementView } from "./ProviderManagementView.js";
import { ProviderProfileStore, InMemoryCredentialStore } from "@fecode/agent";

describe("ProviderManagementView", () => {
  let tmpDir: string;
  let testFilePath: string;
  let credentialStore: InMemoryCredentialStore;
  let profileStore: ProviderProfileStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-tui-test-"));
    testFilePath = path.join(tmpDir, "providers.json");
    credentialStore = new InMemoryCredentialStore();
    profileStore = new ProviderProfileStore(testFilePath, credentialStore);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("renders first-run onboarding screen with welcome message and provider options", () => {
    const { lastFrame } = render(
      <ProviderManagementView
        initialMode="onboarding"
        profileStore={profileStore}
        credentialStore={credentialStore}
        onClose={() => {}}
      />
    );

    const frame = lastFrame() || "";
    expect(frame).toContain("Welcome to FeCode");
    expect(frame).toContain("Configure your AI provider");
    expect(frame).toContain("Select a provider:");
    expect(frame).toContain("Google Gemini");
    expect(frame).toContain("OpenAI");
    expect(frame).toContain("Ollama");
    expect(frame).toContain("OpenAI-compatible");
    expect(frame).toContain("Enter to continue");
  });

  it("supports keyboard navigation in provider selection", async () => {
    const { lastFrame, stdin } = render(
      <ProviderManagementView
        initialMode="onboarding"
        profileStore={profileStore}
        credentialStore={credentialStore}
        onClose={() => {}}
      />
    );

    await new Promise((r) => setTimeout(r, 50));
    let frame = lastFrame() || "";
    expect(frame).toContain("> Google Gemini");

    // Press down arrow
    stdin.write("\u001B[B");
    await new Promise((r) => setTimeout(r, 50));
    frame = lastFrame() || "";
    expect(frame).toContain("> OpenAI");
  });

  it("renders profile list with active indicator when saved profiles exist", async () => {
    await profileStore.saveProfile({
      providerId: "gemini",
      displayName: "Gemini Flash",
      model: "gemini-2.5-flash",
      apiKey: "test-key"
    });
    await profileStore.saveProfile({
      providerId: "openai",
      displayName: "OpenAI GPT-4o",
      model: "gpt-4o",
      apiKey: "test-key"
    });

    const { lastFrame } = render(
      <ProviderManagementView
        initialMode="list"
        profileStore={profileStore}
        credentialStore={credentialStore}
        onClose={() => {}}
      />
    );

    // Wait for useEffect profile loading
    await new Promise((r) => setTimeout(r, 50));

    const frame = lastFrame() || "";
    expect(frame).toContain("Saved Provider Profiles");
    expect(frame).toContain("Gemini Flash");
    expect(frame).toContain("OpenAI GPT-4o");
    expect(frame).toContain("* [ACTIVE]");
    expect(frame).toContain("[Enter/a] Activate");
    expect(frame).toContain("[n] Add");
    expect(frame).toContain("[d] Delete");
  });

  it("renders safe details in show mode without revealing secrets", async () => {
    const rawApiKey = "sk-secret-key-that-must-never-appear";
    const profile = await profileStore.saveProfile({
      providerId: "openai-compatible",
      displayName: "NVIDIA NIM",
      model: "deepseek-ai/deepseek-v4.1-flash",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKey: rawApiKey
    });

    const { lastFrame } = render(
      <ProviderManagementView
        initialMode="show"
        selectedProfileId={profile.id}
        profileStore={profileStore}
        credentialStore={credentialStore}
        onClose={() => {}}
      />
    );

    await new Promise((r) => setTimeout(r, 50));

    const frame = lastFrame() || "";
    expect(frame).toContain("Provider Profile Details");
    expect(frame).toContain("NVIDIA NIM");
    expect(frame).toContain("deepseek-ai/deepseek-v4.1-flash");
    expect(frame).toContain("https://integrate.api.nvidia.com/v1");
    expect(frame).toContain("Credential Storage:");
    expect(frame).toContain("OS Credential Manager");

    // ABSOLUTE SECURITY REQUIREMENT: raw secret must NEVER appear!
    expect(frame).not.toContain(rawApiKey);
  });

  it("renders delete confirmation dialog with explicit y/n prompt", async () => {
    const profile = await profileStore.saveProfile({
      providerId: "gemini",
      displayName: "Gemini To Delete",
      model: "gemini-2.5-flash",
      apiKey: "key"
    });

    const { lastFrame, stdin } = render(
      <ProviderManagementView
        initialMode="list"
        selectedProfileId={profile.id}
        profileStore={profileStore}
        credentialStore={credentialStore}
        onClose={() => {}}
      />
    );

    await new Promise((r) => setTimeout(r, 50));

    // Press 'd' to trigger delete confirmation
    stdin.write("d");

    const frame = lastFrame() || "";
    expect(frame).toContain("Delete Provider Profile?");
    expect(frame).toContain('Are you sure you want to delete profile "Gemini To Delete"');
    expect(frame).toContain("Press [y] to Confirm");
  });
});
