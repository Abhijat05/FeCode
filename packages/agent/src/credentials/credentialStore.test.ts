import { describe, it, expect, vi } from "vitest";
import {
  InMemoryCredentialStore,
  NativeKeyringCredentialStore,
  SecureCredentialStoreUnavailableError
} from "./credentialStore.js";

describe("CredentialStore", () => {
  it("sets, gets, and deletes credentials correctly", async () => {
    const store = new InMemoryCredentialStore();
    const ref = "fecode:profile:gemini-test-1";

    expect(await store.get(ref)).toBeNull();

    await store.set(ref, "secret-key-12345");
    expect(await store.get(ref)).toBe("secret-key-12345");

    await store.delete(ref);
    expect(await store.get(ref)).toBeNull();
  });

  it("handles missing credentials gracefully without throwing", async () => {
    const store = new InMemoryCredentialStore();
    expect(await store.get("non-existent")).toBeNull();
    await expect(store.delete("non-existent")).resolves.not.toThrow();
  });

  it("isolates credentials strictly between different profiles", async () => {
    const store = new InMemoryCredentialStore();
    const refA = "fecode:profile:prof-a";
    const refB = "fecode:profile:prof-b";

    await store.set(refA, "key-for-profile-a");
    await store.set(refB, "key-for-profile-b");

    expect(await store.get(refA)).toBe("key-for-profile-a");
    expect(await store.get(refB)).toBe("key-for-profile-b");

    // Deleting profile A does not delete or alter profile B
    await store.delete(refA);
    expect(await store.get(refA)).toBeNull();
    expect(await store.get(refB)).toBe("key-for-profile-b");
  });

  it("supports credential replacement", async () => {
    const store = new InMemoryCredentialStore();
    const ref = "fecode:profile:replace-test";

    await store.set(ref, "initial-secret");
    expect(await store.get(ref)).toBe("initial-secret");

    await store.set(ref, "updated-secret");
    expect(await store.get(ref)).toBe("updated-secret");
  });

  it("throws SecureCredentialStoreUnavailableError when store is unavailable", async () => {
    const store = new InMemoryCredentialStore();
    store.isAvailable = false;

    await expect(store.get("ref")).rejects.toThrow(
      SecureCredentialStoreUnavailableError
    );
    await expect(store.set("ref", "secret")).rejects.toThrow(
      SecureCredentialStoreUnavailableError
    );
    await expect(store.delete("ref")).rejects.toThrow(
      SecureCredentialStoreUnavailableError
    );
  });

  it("NativeKeyringCredentialStore reports helpful error when underlying OS vault fails", async () => {
    const store = new NativeKeyringCredentialStore("fecode-test-err");
    // Mock @napi-rs/keyring failure
    vi.doMock("@napi-rs/keyring", () => {
      return {
        AsyncEntry: class {
          async getPassword() {
            throw new Error("Access denied (Windows error code 5)");
          }
          async setPassword() {
            throw new Error("Access denied");
          }
          async deletePassword() {
            throw new Error("Access denied");
          }
        }
      };
    });

    try {
      await expect(store.get("ref-123")).rejects.toThrow(
        SecureCredentialStoreUnavailableError
      );
    } finally {
      vi.doUnmock("@napi-rs/keyring");
    }
  });
});
