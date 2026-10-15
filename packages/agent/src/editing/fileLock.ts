import * as path from "path";

/**
 * File-level concurrency lock / serialization mutex.
 * Guarantees that concurrent edit or write operations targeting the same file
 * are executed sequentially to prevent race conditions and lost updates.
 */
export class FileLockManager {
  private static instance: FileLockManager;
  private readonly locks = new Map<string, Promise<unknown>>();

  public static getInstance(): FileLockManager {
    if (!FileLockManager.instance) {
      FileLockManager.instance = new FileLockManager();
    }
    return FileLockManager.instance;
  }

  /**
   * Acquires an exclusive file write lock and executes the operation.
   */
  public async acquire<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
    const key = path.resolve(filePath).toLowerCase();
    const currentLock = this.locks.get(key) || Promise.resolve();

    let opResolve!: (val: T) => void;
    let opReject!: (err: unknown) => void;
    const opPromise = new Promise<T>((resolve, reject) => {
      opResolve = resolve;
      opReject = reject;
    });

    const nextLock = currentLock
      .then(async () => {
        try {
          const result = await operation();
          opResolve(result);
        } catch (err: unknown) {
          opReject(err);
        }
      })
      .catch(() => {});

    this.locks.set(key, nextLock);

    nextLock.finally(() => {
      if (this.locks.get(key) === nextLock) {
        this.locks.delete(key);
      }
    });

    return opPromise;
  }

  /**
   * Clears all locks (for testing).
   */
  public clear(): void {
    this.locks.clear();
  }
}
