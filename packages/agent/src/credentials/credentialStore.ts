import type { CredentialStore } from "./types.js";

export const FEC_KEYRING_SERVICE = "fecode";

export class SecureCredentialStoreUnavailableError extends Error {
  constructor(
    message: string = "Operating system secure credential store is unavailable or access was denied.",
    public readonly cause?: unknown
  ) {
    super(
      `${message}\n\nTroubleshooting:\n` +
      `- Windows: Ensure you are running in a user session with access to Windows Credential Manager.\n` +
      `- macOS: Ensure Keychain is unlocked and accessible.\n` +
      `- Linux: Ensure a Secret Service daemon (e.g. GNOME Keyring, KWallet) or kernel keyutils is active.\n` +
      `- Headless/CI: Configure API keys using standard environment variables (e.g. GEMINI_API_KEY, OPENAI_API_KEY).`
    );
    this.name = "SecureCredentialStoreUnavailableError";
  }
}

/**
 * Operating system credential store backed by native OS vaults:
 * - Windows: Windows Credential Manager
 * - macOS: Apple Keychain
 * - Linux: Secret Service API / Kernel Keyutils
 *
 * Implemented using @napi-rs/keyring.
 */
export class NativeKeyringCredentialStore implements CredentialStore {
  private readonly serviceName: string;

  constructor(serviceName: string = FEC_KEYRING_SERVICE) {
    this.serviceName = serviceName;
  }

  public async get(reference: string): Promise<string | null> {
    if (!reference) return null;
    try {
      const { AsyncEntry } = await import("@napi-rs/keyring");
      const entry = new AsyncEntry(this.serviceName, reference);
      const secret = await entry.getPassword();
      return secret;
    } catch (err: unknown) {
      // In @napi-rs/keyring, missing entry returns null, but platform errors throw.
      throw new SecureCredentialStoreUnavailableError(
        `Failed to retrieve credential from OS credential store for "${reference}".`,
        err
      );
    }
  }

  public async set(reference: string, secret: string): Promise<void> {
    if (!reference) {
      throw new Error("Cannot store credential without an opaque reference.");
    }
    if (!secret) {
      await this.delete(reference);
      return;
    }
    try {
      const { AsyncEntry } = await import("@napi-rs/keyring");
      const entry = new AsyncEntry(this.serviceName, reference);
      await entry.setPassword(secret);
    } catch (err: unknown) {
      throw new SecureCredentialStoreUnavailableError(
        `Failed to persist credential in OS credential store for "${reference}".`,
        err
      );
    }
  }

  public async delete(reference: string): Promise<void> {
    if (!reference) return;
    try {
      const { AsyncEntry } = await import("@napi-rs/keyring");
      const entry = new AsyncEntry(this.serviceName, reference);
      await entry.deletePassword();
    } catch (err: unknown) {
      // If the entry already doesn't exist, ignore. Otherwise throw if backend failed.
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.toLowerCase().includes("not found") ||
        msg.toLowerCase().includes("no such")
      ) {
        return;
      }
      throw new SecureCredentialStoreUnavailableError(
        `Failed to remove credential from OS credential store for "${reference}".`,
        err
      );
    }
  }
}

/**
 * In-memory credential store for tests and non-persistent verification.
 */
export class InMemoryCredentialStore implements CredentialStore {
  private readonly storage = new Map<string, string>();
  public isAvailable = true;

  public async get(reference: string): Promise<string | null> {
    if (!this.isAvailable) {
      throw new SecureCredentialStoreUnavailableError(
        "In-memory credential store is marked unavailable."
      );
    }
    return this.storage.get(reference) ?? null;
  }

  public async set(reference: string, secret: string): Promise<void> {
    if (!this.isAvailable) {
      throw new SecureCredentialStoreUnavailableError(
        "In-memory credential store is marked unavailable."
      );
    }
    if (!secret) {
      this.storage.delete(reference);
      return;
    }
    this.storage.set(reference, secret);
  }

  public async delete(reference: string): Promise<void> {
    if (!this.isAvailable) {
      throw new SecureCredentialStoreUnavailableError(
        "In-memory credential store is marked unavailable."
      );
    }
    this.storage.delete(reference);
  }

  public clear(): void {
    this.storage.clear();
  }
}

export function createDefaultCredentialStore(): CredentialStore {
  return new NativeKeyringCredentialStore();
}
