import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "ink-testing-library";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { ProviderManagementView } from "./ProviderManagementView.js";
import * as agentModule from "@fecode/agent";
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
    vi.restoreAllMocks();
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

  it("triggers discovery when advancing to model field", async () => {
    let resolveDiscovery: (val: { success: boolean; models: agentModule.DiscoveredModel[] }) => void = () => {};
    const discoveryPromise = new Promise<{ success: boolean; models: agentModule.DiscoveredModel[] }>((resolve) => {
      resolveDiscovery = resolve;
    });

    const discoverSpy = vi
      .spyOn(agentModule, "discoverAvailableModels")
      .mockReturnValue(discoveryPromise as Promise<agentModule.DiscoverModelsResult>);

    const { lastFrame, stdin } = render(
      <ProviderManagementView
        initialMode="onboarding"
        profileStore={profileStore}
        credentialStore={credentialStore}
        onClose={() => {}}
      />
    );

    await new Promise((r) => setTimeout(r, 50));
    // Press Enter to select Google Gemini
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 50));

    let frame = lastFrame() || "";
    expect(frame).toContain("Configure AI Provider");
    expect(frame).toContain("API Key:");

    // Type API key and press enter to advance to model field
    stdin.write("test-gemini-key");
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 50));

    expect(discoverSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "gemini",
        apiKey: "test-gemini-key"
      })
    );

    frame = lastFrame() || "";
    expect(frame).toContain("⟳ Detecting available models for this provider...");

    // Resolve discovery
    resolveDiscovery({
      success: true,
      models: [
        { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", isRecommended: true },
        { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro" }
      ]
    });

    await new Promise((r) => setTimeout(r, 50));
    frame = lastFrame() || "";
    expect(frame).not.toContain("⟳ Detecting available models");
    expect(frame).toContain("> Gemini 2.5 Flash");
  });

  it("interactive selector renders discovered models and recommended tags", async () => {
    vi.spyOn(agentModule, "discoverAvailableModels").mockResolvedValue({
      success: true,
      models: [
        { id: "model-alpha", displayName: "Model Alpha", isRecommended: true },
        { id: "model-beta", displayName: "Model Beta" }
      ]
    });

    const { lastFrame, stdin } = render(
      <ProviderManagementView
        initialMode="onboarding"
        profileStore={profileStore}
        credentialStore={credentialStore}
        onClose={() => {}}
      />
    );

    await new Promise((r) => setTimeout(r, 50));
    // Select Gemini
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 50));

    // Submit API key to trigger discovery and focus model
    stdin.write("test-key");
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 100));

    const frame = lastFrame() || "";
    expect(frame).toContain("> Model Alpha (model-alpha) (Recommended)");
    expect(frame).toContain("Model Beta (model-beta)");
    expect(frame).toContain("[ Custom Model ID... ]");
    expect(frame).toContain("[↑/↓] Select   [Enter] Confirm   [m] Custom ID   [r] Refresh");
  });

  it("arrow keys update the selected model", async () => {
    vi.spyOn(agentModule, "discoverAvailableModels").mockResolvedValue({
      success: true,
      models: [
        { id: "model-alpha", displayName: "Model Alpha", isRecommended: true },
        { id: "model-beta", displayName: "Model Beta" }
      ]
    });

    const { lastFrame, stdin } = render(
      <ProviderManagementView
        initialMode="onboarding"
        profileStore={profileStore}
        credentialStore={credentialStore}
        onClose={() => {}}
      />
    );

    await new Promise((r) => setTimeout(r, 50));
    stdin.write("\r"); // enter form
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("test-key");
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("\r"); // advance to model
    await new Promise((r) => setTimeout(r, 100));

    let frame = lastFrame() || "";
    expect(frame).toContain("> Model Alpha");

    // Press down arrow
    stdin.write("\u001B[B");
    await new Promise((r) => setTimeout(r, 50));
    frame = lastFrame() || "";
    expect(frame).toContain("> Model Beta");
    expect(frame).not.toContain("> Model Alpha");

    // Press down arrow again to select Custom Model ID option
    stdin.write("\u001B[B");
    await new Promise((r) => setTimeout(r, 50));
    frame = lastFrame() || "";
    expect(frame).toContain("> [ Custom Model ID... ]");

    // Press down arrow again to wrap around back to top item
    stdin.write("\u001B[B");
    await new Promise((r) => setTimeout(r, 50));
    frame = lastFrame() || "";
    expect(frame).toContain("> Model Alpha");

    // Press up arrow to wrap back to bottom item
    stdin.write("\u001B[A");
    await new Promise((r) => setTimeout(r, 50));
    frame = lastFrame() || "";
    expect(frame).toContain("> [ Custom Model ID... ]");
  });

  it("selecting [ Custom Model ID... ] activates custom text input", async () => {
    vi.spyOn(agentModule, "discoverAvailableModels").mockResolvedValue({
      success: true,
      models: [
        { id: "model-1", displayName: "Model 1", isRecommended: true }
      ]
    });

    const { lastFrame, stdin } = render(
      <ProviderManagementView
        initialMode="onboarding"
        profileStore={profileStore}
        credentialStore={credentialStore}
        onClose={() => {}}
      />
    );

    await new Promise((r) => setTimeout(r, 50));
    stdin.write("\r"); // enter form
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("test-key");
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("\r"); // advance to model
    await new Promise((r) => setTimeout(r, 100));

    // Down arrow to [ Custom Model ID... ]
    stdin.write("\u001B[B");
    await new Promise((r) => setTimeout(r, 50));
    let frame = lastFrame() || "";
    expect(frame).toContain("> [ Custom Model ID... ]");

    // Press enter on Custom Model ID to activate custom text input
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 50));

    frame = lastFrame() || "";
    expect(frame).toContain("[Esc] Back to discovered models list");

    // Esc toggles back to discovered models list
    stdin.write("\u001B");
    await new Promise((r) => setTimeout(r, 50));
    frame = lastFrame() || "";
    expect(frame).toContain("> Model 1");
    expect(frame).toContain("[↑/↓] Select   [Enter] Confirm   [m] Custom ID   [r] Refresh");

    // Pressing 'm' also activates custom text input
    stdin.write("m");
    await new Promise((r) => setTimeout(r, 50));
    frame = lastFrame() || "";
    expect(frame).toContain("[Esc] Back to discovered models list");
  });

  it("re-fetches models when 'r' key is pressed while model field is focused", async () => {
    let callCount = 0;
    vi.spyOn(agentModule, "discoverAvailableModels").mockImplementation(async () => {
      callCount++;
      return {
        success: true,
        models: [
          { id: `model-v${callCount}`, displayName: `Model V${callCount}`, isRecommended: true }
        ]
      };
    });

    const { lastFrame, stdin } = render(
      <ProviderManagementView
        initialMode="onboarding"
        profileStore={profileStore}
        credentialStore={credentialStore}
        onClose={() => {}}
      />
    );

    await new Promise((r) => setTimeout(r, 50));
    stdin.write("\r"); // enter form
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("test-key");
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("\r"); // advance to model
    await new Promise((r) => setTimeout(r, 100));

    expect(callCount).toBe(1);
    let frame = lastFrame() || "";
    expect(frame).toContain("> Model V1");

    // Press 'r' to re-fetch
    stdin.write("r");
    await new Promise((r) => setTimeout(r, 100));

    expect(callCount).toBe(2);
    frame = lastFrame() || "";
    expect(frame).toContain("> Model V2");
  });

  it("confirms selected model on Enter and advances to connection testing", async () => {
    vi.spyOn(agentModule, "discoverAvailableModels").mockResolvedValue({
      success: true,
      models: [
        { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", isRecommended: true },
        { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro" }
      ]
    });

    const testConnectionSpy = vi.spyOn(agentModule, "testProviderConnection").mockResolvedValue({
      success: true,
      providerId: "gemini",
      model: "gemini-2.5-pro",
      steps: { authentication: "success", modelAvailable: "success" },
      durationMs: 42,
      message: "Connected"
    });

    const { lastFrame, stdin } = render(
      <ProviderManagementView
        initialMode="onboarding"
        profileStore={profileStore}
        credentialStore={credentialStore}
        onClose={() => {}}
      />
    );

    await new Promise((r) => setTimeout(r, 50));
    stdin.write("\r"); // enter form
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("my-api-key");
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("\r"); // advance to model
    await new Promise((r) => setTimeout(r, 100));

    // Move to gemini-2.5-pro
    stdin.write("\u001B[B");
    await new Promise((r) => setTimeout(r, 50));

    // Press Enter to confirm selection and submit form
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 100));

    expect(testConnectionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "gemini",
        model: "gemini-2.5-pro",
        apiKey: "my-api-key"
      })
    );

    const frame = lastFrame() || "";
    expect(frame).toContain("✓ Connection Successful");
  });

  it("if discovery fails, curated default models are presented cleanly with fallback notice", async () => {
    vi.spyOn(agentModule, "discoverAvailableModels").mockResolvedValue({
      success: false,
      models: agentModule.getCuratedDefaultModels("gemini"),
      error: "Network offline: fetch failed"
    });

    const { lastFrame, stdin } = render(
      <ProviderManagementView
        initialMode="onboarding"
        profileStore={profileStore}
        credentialStore={credentialStore}
        onClose={() => {}}
      />
    );

    await new Promise((r) => setTimeout(r, 50));
    stdin.write("\r"); // enter form
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("fake-key");
    await new Promise((r) => setTimeout(r, 50));
    stdin.write("\r"); // advance to model
    await new Promise((r) => setTimeout(r, 100));

    const frame = lastFrame() || "";
    expect(frame).toContain("Gemini 2.5 Flash");
    expect(frame).toContain("(Recommended)");
    expect(frame).toContain("Fallback models in use: Network offline: fetch failed");
    expect(frame).toContain("[↑/↓] Select   [Enter] Confirm   [m] Custom ID   [r] Refresh");
  });

  it("triggers discovery with baseUrl when advancing to model field in Ollama", async () => {
    const discoverSpy = vi.spyOn(agentModule, "discoverAvailableModels").mockResolvedValue({
      success: true,
      models: [
        { id: "qwen2.5-coder", displayName: "Qwen 2.5 Coder", isRecommended: true },
        { id: "llama3.1", displayName: "Llama 3.1" }
      ]
    });

    const { lastFrame, stdin } = render(
      <ProviderManagementView
        initialMode="onboarding"
        profileStore={profileStore}
        credentialStore={credentialStore}
        onClose={() => {}}
      />
    );

    await new Promise((r) => setTimeout(r, 50));
    // Navigate down to Ollama (gemini -> openai -> ollama)
    stdin.write("\u001B[B");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\u001B[B");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r"); // Enter Ollama form
    await new Promise((r) => setTimeout(r, 50));

    let frame = lastFrame() || "";
    expect(frame).toContain("Base URL:");

    // Press Enter to keep default baseUrl (http://localhost:11434/v1) and advance to model
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 100));

    expect(discoverSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "ollama",
        baseUrl: "http://localhost:11434/v1"
      })
    );

    frame = lastFrame() || "";
    expect(frame).toContain("> Qwen 2.5 Coder");
    expect(frame).toContain("Llama 3.1");
  });

  it("allows going back / cancelling from onboarding-select when no profiles exist", async () => {
    let closed = false;
    const { stdin } = render(
      <ProviderManagementView
        initialMode="onboarding"
        profileStore={profileStore}
        credentialStore={credentialStore}
        onClose={() => {
          closed = true;
        }}
      />
    );

    await new Promise((r) => setTimeout(r, 50));
    // Press Esc
    stdin.write("\u001B");
    await new Promise((r) => setTimeout(r, 50));
    expect(closed).toBe(true);
  });

  it("allows selecting '[ Cancel / Exit to Main ]' option to close onboarding when no profiles exist", async () => {
    let closed = false;
    const { lastFrame, stdin } = render(
      <ProviderManagementView
        initialMode="onboarding"
        profileStore={profileStore}
        credentialStore={credentialStore}
        onClose={() => {
          closed = true;
        }}
      />
    );

    await new Promise((r) => setTimeout(r, 50));
    let frame = lastFrame() || "";
    expect(frame).toContain("[ Cancel / Exit to Main ]");

    // Navigate to 4th down arrow (gemini -> openai -> ollama -> openai-compatible -> cancel option)
    for (let i = 0; i < 4; i++) {
      stdin.write("\u001B[B");
      await new Promise((r) => setTimeout(r, 30));
    }

    frame = lastFrame() || "";
    expect(frame).toContain("> [ Cancel / Exit to Main ]");

    // Press Enter to confirm cancel
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 50));
    expect(closed).toBe(true);
  });

  it("navigates back to provider list when adding a provider and selecting '[ Back to Provider List ]' or pressing Esc", async () => {
    await profileStore.saveProfile({
      providerId: "gemini",
      displayName: "Gemini Existing",
      model: "gemini-2.5-flash",
      apiKey: "key"
    });

    const { lastFrame, stdin } = render(
      <ProviderManagementView
        initialMode="list"
        profileStore={profileStore}
        credentialStore={credentialStore}
        onClose={() => {}}
      />
    );

    await new Promise((r) => setTimeout(r, 50));
    let frame = lastFrame() || "";
    expect(frame).toContain("Saved Provider Profiles");

    // Press 'n' to add a new provider
    stdin.write("n");
    await new Promise((r) => setTimeout(r, 50));

    frame = lastFrame() || "";
    expect(frame).toContain("Add New Provider");
    expect(frame).toContain("[ Back to Provider List ]");

    // Press Esc to go back to list
    stdin.write("\u001B");
    await new Promise((r) => setTimeout(r, 50));

    frame = lastFrame() || "";
    expect(frame).toContain("Saved Provider Profiles");
    expect(frame).toContain("Gemini Existing");

    // Press 'n' again and navigate down to '[ Back to Provider List ]'
    stdin.write("n");
    await new Promise((r) => setTimeout(r, 50));

    for (let i = 0; i < 4; i++) {
      stdin.write("\u001B[B");
      await new Promise((r) => setTimeout(r, 30));
    }

    frame = lastFrame() || "";
    expect(frame).toContain("> [ Back to Provider List ]");

    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 50));

    frame = lastFrame() || "";
    expect(frame).toContain("Saved Provider Profiles");
  });

  it("pressing Esc in form mode when adding a new provider returns to provider selection", async () => {
    const { lastFrame, stdin } = render(
      <ProviderManagementView
        initialMode="onboarding"
        profileStore={profileStore}
        credentialStore={credentialStore}
        onClose={() => {}}
      />
    );

    await new Promise((r) => setTimeout(r, 50));
    // Select Gemini
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 50));

    let frame = lastFrame() || "";
    expect(frame).toContain("Configure AI Provider");
    expect(frame).toContain("API Key:");

    // Press Esc to go back to provider selection
    stdin.write("\u001B");
    await new Promise((r) => setTimeout(r, 50));

    frame = lastFrame() || "";
    expect(frame).toContain("Select a provider:");
    expect(frame).toContain("Google Gemini");
  });
});
