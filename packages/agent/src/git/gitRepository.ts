import { spawn } from "child_process";
import type {
  GitRepository,
  GitStatus,
  RepositorySnapshot
} from "./types.js";
import { parseGitStatusPorcelain } from "./parser.js";
import { prepareChildEnvironment } from "../commands/nodeExecutor.js";

export type GitCommandRunner = (
  args: string[],
  cwd: string,
  signal?: AbortSignal
) => Promise<{ stdout: string; stderr: string; exitCode: number | null }>;

export class DefaultGitRepository implements GitRepository {
  private readonly runner: GitCommandRunner;

  constructor(runner?: GitCommandRunner) {
    this.runner = runner || DefaultGitRepository.defaultRunner;
  }

  public static defaultRunner: GitCommandRunner = async (
    args: string[],
    cwd: string,
    signal?: AbortSignal
  ) => {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        return resolve({
          stdout: "",
          stderr: "Aborted",
          exitCode: null
        });
      }

      const env = prepareChildEnvironment();
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn("git", args, {
          cwd,
          env,
          shell: false
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return resolve({
          stdout: "",
          stderr: msg,
          exitCode: null
        });
      }

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf-8");
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
      });

      const timer = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          // Ignore
        }
      }, 10000);

      const onAbort = () => {
        try {
          child.kill("SIGTERM");
        } catch {
          // Ignore
        }
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      child.on("error", (err) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve({
          stdout,
          stderr: err.message,
          exitCode: null
        });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve({
          stdout,
          stderr,
          exitCode: code
        });
      });
    });
  };

  public async isRepository(cwd: string): Promise<boolean> {
    try {
      const res = await this.runner(
        ["rev-parse", "--is-inside-work-tree"],
        cwd
      );
      return res.exitCode === 0 && res.stdout.trim() === "true";
    } catch {
      return false;
    }
  }

  public async getRoot(cwd: string): Promise<string | null> {
    try {
      const res = await this.runner(["rev-parse", "--show-toplevel"], cwd);
      if (res.exitCode === 0 && res.stdout.trim()) {
        return res.stdout.trim().replace(/\\/g, "/");
      }
      return null;
    } catch {
      return null;
    }
  }

  public async getBranch(cwd: string): Promise<string | null> {
    try {
      const res = await this.runner(["branch", "--show-current"], cwd);
      if (res.exitCode === 0 && res.stdout.trim()) {
        return res.stdout.trim();
      }

      // Check symbolic-ref (works on unborn HEAD / initial commit)
      const symRefRes = await this.runner(["symbolic-ref", "--short", "HEAD"], cwd);
      if (symRefRes.exitCode === 0 && symRefRes.stdout.trim()) {
        return symRefRes.stdout.trim();
      }

      // If detached HEAD or initial commit
      const statusRes = await this.runner(["status", "--porcelain=v1", "-b"], cwd);
      if (statusRes.exitCode === 0) {
        const parsed = parseGitStatusPorcelain(statusRes.stdout);
        return parsed.branch;
      }
      return null;
    } catch {
      return null;
    }
  }

  public async getStatus(cwd: string): Promise<GitStatus> {
    try {
      const isRepo = await this.isRepository(cwd);
      if (!isRepo) {
        // Check if git executable is available at all
        const versionRes = await this.runner(["--version"], cwd);
        const gitAvailable = versionRes.exitCode === 0;

        return {
          isRepository: false,
          gitAvailable,
          root: null,
          branch: null,
          files: [],
          ahead: null,
          behind: null,
          hasConflicts: false
        };
      }

      const root = await this.getRoot(cwd);
      const statusRes = await this.runner(["status", "--porcelain=v1", "-b"], cwd);
      if (statusRes.exitCode !== 0) {
        return {
          isRepository: true,
          gitAvailable: true,
          root,
          branch: null,
          files: [],
          ahead: null,
          behind: null,
          hasConflicts: false
        };
      }

      const parsed = parseGitStatusPorcelain(statusRes.stdout);
      const branch = parsed.branch || (await this.getBranch(cwd));
      return {
        isRepository: true,
        gitAvailable: true,
        root,
        branch,
        files: parsed.files,
        ahead: parsed.ahead,
        behind: parsed.behind,
        hasConflicts: parsed.hasConflicts
      };
    } catch {
      return {
        isRepository: false,
        gitAvailable: false,
        root: null,
        branch: null,
        files: [],
        ahead: null,
        behind: null,
        hasConflicts: false
      };
    }
  }

  public async getSnapshot(cwd: string): Promise<RepositorySnapshot> {
    const status = await this.getStatus(cwd);
    return {
      capturedAt: new Date().toISOString(),
      root: status.root,
      branch: status.branch,
      files: status.files
    };
  }
}
