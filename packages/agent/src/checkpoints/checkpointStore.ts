import * as fs from "fs/promises";
import * as path from "path";
import { getDefaultCheckpointsDir } from "./pathResolver.js";
import type { Checkpoint, CheckpointStore } from "./types.js";

function isValidCheckpointId(id: string): boolean {
  if (!id || typeof id !== "string") return false;
  return /^[a-zA-Z0-9_.-]+$/.test(id) && !id.includes("..");
}

export class DefaultCheckpointStore implements CheckpointStore {
  private readonly storageDir: string;
  private readonly maxCheckpoints: number;

  constructor(storageDir?: string, maxCheckpoints: number = 10) {
    this.storageDir = storageDir || getDefaultCheckpointsDir();
    this.maxCheckpoints = maxCheckpoints;
  }

  public getStorageDir(): string {
    return this.storageDir;
  }

  public async save(checkpoint: Checkpoint): Promise<void> {
    if (!isValidCheckpointId(checkpoint.id)) {
      throw new Error(`Invalid checkpointId: ${checkpoint.id}`);
    }

    try {
      await fs.mkdir(this.storageDir, { recursive: true, mode: 0o700 });
    } catch {
      // Ignore directory creation error
    }

    const tempFile = path.join(
      this.storageDir,
      `${checkpoint.id}.${Date.now()}.${Math.random().toString(36).substring(2, 7)}.tmp`
    );
    const targetFile = path.join(this.storageDir, `${checkpoint.id}.json`);

    const dataToSave: Checkpoint = {
      ...checkpoint,
      createdAt: checkpoint.createdAt || new Date().toISOString()
    };

    const serialized = JSON.stringify(dataToSave, null, 2);

    try {
      await fs.writeFile(tempFile, serialized, {
        encoding: "utf-8",
        mode: 0o600
      });
      await fs.rename(tempFile, targetFile);
    } catch (err: unknown) {
      try {
        await fs.unlink(tempFile);
      } catch {
        // ignore
      }
      throw err;
    }

    // Enforce retention limit
    await this.pruneOldCheckpoints(checkpoint.id);
  }

  public async get(id: string): Promise<Checkpoint | null> {
    if (!isValidCheckpointId(id)) {
      return null;
    }

    const targetFile = path.join(this.storageDir, `${id}.json`);

    try {
      const raw = await fs.readFile(targetFile, "utf-8");
      const parsed = JSON.parse(raw) as Checkpoint;
      return parsed;
    } catch {
      return null;
    }
  }

  public async list(): Promise<Checkpoint[]> {
    try {
      await fs.mkdir(this.storageDir, { recursive: true, mode: 0o700 });
      const entries = await fs.readdir(this.storageDir, { withFileTypes: true });
      const jsonFiles = entries.filter(
        (e) => e.isFile() && e.name.endsWith(".json") && !e.name.endsWith(".tmp")
      );

      const list: Checkpoint[] = [];
      for (const f of jsonFiles) {
        const fullPath = path.join(this.storageDir, f.name);
        try {
          const raw = await fs.readFile(fullPath, "utf-8");
          const parsed = JSON.parse(raw) as Checkpoint;
          if (parsed && parsed.id) {
            list.push(parsed);
          }
        } catch {
          // Ignore unreadable or corrupted files
        }
      }

      // Sort newest first
      list.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      return list;
    } catch {
      return [];
    }
  }

  public async remove(id: string): Promise<void> {
    if (!isValidCheckpointId(id)) return;

    const targetFile = path.join(this.storageDir, `${id}.json`);
    try {
      await fs.unlink(targetFile);
    } catch {
      // Ignore if not found
    }
  }

  private async pruneOldCheckpoints(activeId?: string): Promise<void> {
    try {
      const all = await this.list();
      if (all.length <= this.maxCheckpoints) return;

      const toPrune = all.slice(this.maxCheckpoints);
      for (const cp of toPrune) {
        if (activeId && cp.id === activeId) continue;
        await this.remove(cp.id);
      }
    } catch {
      // Ignore pruning errors
    }
  }
}
