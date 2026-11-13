import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { App } from "./App.js";
import {
  ProviderProfileStore,
  InMemoryCredentialStore,
  type Agent,
  type AgentEvent
} from "@fecode/agent";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function typeAndSubmit(stdin: { write: (data: string) => void }, text: string) {
  for (const char of text) {
    stdin.write(char);
    await delay(20);
  }
  await delay(30);
  stdin.write("\r");
  await delay(100);
}

class MockAgent implements Agent {
  public isCancelled = false;
  public async *run(): AsyncIterable<AgentEvent> {
    yield { type: "text", content: "ok" };
    yield { type: "done" };
  }
  public async cancel(): Promise<void> {
    this.isCancelled = true;
  }
}

describe("/provider Slash Commands in App", () => {
  let tmpDir: string;
  let providersPath: string;
  let credentialStore: InMemoryCredentialStore;
  let profileStore: ProviderProfileStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-app-cmd-test-"));
    providersPath = path.join(tmpDir, "providers.json");
    credentialStore = new InMemoryCredentialStore();
    profileStore = new ProviderProfileStore(providersPath, credentialStore);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("handles /provider list and displays saved profiles safely", async () => {
    await profileStore.saveProfile({
      providerId: "gemini",
      displayName: "Gemini 2.5",
      model: "gemini-2.5-flash",
      apiKey: "secret-key-1"
    });
    await profileStore.saveProfile({
      providerId: "openai-compatible",
      displayName: "NVIDIA NIM",
      model: "deepseek-ai/deepseek-v4.1-flash",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKey: "secret-key-2"
    });

    const { lastFrame, stdin } = render(
      <App
        cwd={tmpDir}
        providerName="gemini"
        modelName="gemini-2.5-flash"
        profileStore={profileStore}
        credentialStore={credentialStore}
        clampResponses={false}
      />
    );

    await delay(100);
    await typeAndSubmit(stdin, "/provider list");

    const frame = lastFrame() || "";
    expect(frame).toContain("Saved Provider Profiles:");
    expect(frame).toContain("Gemini 2.5");
    expect(frame).toContain("NVIDIA NIM");
    expect(frame).toContain("* [ACTIVE]");

    // Zero secret leakage
    expect(frame).not.toContain("secret-key-1");
    expect(frame).not.toContain("secret-key-2");
  });

  it("handles /provider show without leaking credentials", async () => {
    const rawKey = "sk-hidden-secret-key-999";
    const profile = await profileStore.saveProfile({
      providerId: "openai",
      displayName: "OpenAI Main",
      model: "gpt-4o",
      apiKey: rawKey
    });

    const { lastFrame, stdin } = render(
      <App
        cwd={tmpDir}
        providerName="openai"
        modelName="gpt-4o"
        profileStore={profileStore}
        credentialStore={credentialStore}
        clampResponses={false}
      />
    );

    await delay(100);
    await typeAndSubmit(stdin, `/provider show ${profile.id}`);

    const frame = lastFrame() || "";
    expect(frame).toContain("Provider Profile Details:");
    expect(frame).toContain("OpenAI Main");
    expect(frame).toContain("gpt-4o");
    expect(frame).toContain("OS Credential Manager");

    // ABSOLUTE SECURITY RULE: Raw key never in output
    expect(frame).not.toContain(rawKey);
  });

  it("handles /provider use to switch active profile", async () => {
    await profileStore.saveProfile({
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

    const mockAgent = new MockAgent();

    const { lastFrame, stdin } = render(
      <App
        agent={mockAgent}
        cwd={tmpDir}
        providerName="gemini"
        modelName="gemini-2.5-flash"
        profileStore={profileStore}
        credentialStore={credentialStore}
        clampResponses={false}
      />
    );

    await delay(100);
    await typeAndSubmit(stdin, `/provider use ${p2.id}`);

    const frame = lastFrame() || "";
    expect(frame).toContain(`Activated AI provider profile "Ollama Local"`);

    const active = await profileStore.getActiveProfile();
    expect(active?.id).toBe(p2.id);
  });

  it("opens interactive provider management view when running /provider", async () => {
    const mockAgent = new MockAgent();

    const { lastFrame, stdin } = render(
      <App
        agent={mockAgent}
        cwd={tmpDir}
        providerName="gemini"
        modelName="gemini-2.5-flash"
        profileStore={profileStore}
        credentialStore={credentialStore}
        clampResponses={false}
      />
    );

    await delay(100);
    await typeAndSubmit(stdin, "/provider");

    const frame = lastFrame() || "";
    expect(frame).toContain("Saved Provider Profiles");
  });
});
