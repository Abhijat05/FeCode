import * as path from "path";

/**
 * Workspace-scoped execution queue for Git commands.
 * Prevents concurrent git processes from colliding on '.git/index.lock'
 * by serializing all git operations targeting the same repository directory.
 */
export class GitExecutionQueue {
  private static instance: GitExecutionQueue;
  private readonly queues = new Map<string, Promise<unknown>>();

  public static getInstance(): GitExecutionQueue {
    if (!GitExecutionQueue.instance) {
      GitExecutionQueue.instance = new GitExecutionQueue();
    }
    return GitExecutionQueue.instance;
  }

  /**
   * Enqueues an asynchronous git task to run sequentially for the given workspace cwd.
   */
  public async enqueue<T>(cwd: string, task: () => Promise<T>): Promise<T> {
    const key = path.resolve(cwd).toLowerCase();
    const current = this.queues.get(key) || Promise.resolve();

    let taskResolve!: (val: T) => void;
    let taskReject!: (err: unknown) => void;
    const taskPromise = new Promise<T>((resolve, reject) => {
      taskResolve = resolve;
      taskReject = reject;
    });

    const next = current
      .then(async () => {
        try {
          const result = await task();
          taskResolve(result);
        } catch (err: unknown) {
          taskReject(err);
        }
      })
      .catch(() => {});

    this.queues.set(key, next);

    next.finally(() => {
      if (this.queues.get(key) === next) {
        this.queues.delete(key);
      }
    });

    return taskPromise;
  }

  /**
   * Clears all pending queues (for testing).
   */
  public clear(): void {
    this.queues.clear();
  }
}
