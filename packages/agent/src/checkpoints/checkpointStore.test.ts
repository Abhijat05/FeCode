import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { DefaultCheckpointStore } from "./checkpointStore.js";
import type { Checkpoint } from "./types.js";

describe("DefaultCheckpointStore — Phase 5G", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-cp-store-test-"));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("saves, loads, lists, and removes checkpoints", async () => {
    const store = new DefaultCheckpointStore(tmpDir, 10);
    const cp: Checkpoint = {
      id: "checkpoint-20260818-120000-abcd",
      createdAt: new Date().toISOString(),
      repositoryRoot: "/repo",
      branch: "feature/login",
      files: [{ path: "src/Login.tsx", status: "modified" }],
      totalFiles: 1,
      status: "ready",
      isGit: true
    };

    await store.save(cp);

    const loaded = await store.get("checkpoint-20260818-120000-abcd");
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe("checkpoint-20260818-120000-abcd");
    expect(loaded?.branch).toBe("feature/login");
    expect(loaded?.totalFiles).toBe(1);

    const all = await store.list();
    expect(all.length).toBe(1);
    expect(all[0].id).toBe("checkpoint-20260818-120000-abcd");

    await store.remove("checkpoint-20260818-120000-abcd");
    const afterDelete = await store.get("checkpoint-20260818-120000-abcd");
    expect(afterDelete).toBeNull();
  });

  it("rejects invalid checkpoint IDs with path traversal characters", async () => {
    const store = new DefaultCheckpointStore(tmpDir, 10);
    const badCp: Checkpoint = {
      id: "../../../etc/passwd",
      createdAt: new Date().toISOString(),
      repositoryRoot: "/repo",
      branch: "main",
      files: [],
      totalFiles: 0,
      status: "ready",
      isGit: false
    };

    await expect(store.save(badCp)).rejects.toThrow("Invalid checkpointId");
    expect(await store.get("../../../etc/passwd")).toBeNull();
  });

  it("enforces retention limit by pruning oldest checkpoints while preserving active checkpoint", async () => {
    const store = new DefaultCheckpointStore(tmpDir, 3);

    for (let i = 1; i <= 5; i++) {
      const cp: Checkpoint = {
        id: `checkpoint-demo-${i}`,
        createdAt: new Date(Date.now() + i * 1000).toISOString(),
        repositoryRoot: "/repo",
        branch: "main",
        files: [],
        totalFiles: 0,
        status: "ready",
        isGit: true
      };
      await store.save(cp);
    }

    const all = await store.list();
    expect(all.length).toBe(3);
    // Newest 3 should remain
    expect(all.map((c) => c.id)).toEqual([
      "checkpoint-demo-5",
      "checkpoint-demo-4",
      "checkpoint-demo-3"
    ]);
  });
});
