import { spawn, type ChildProcess } from "child_process";

/**
 * Terminate a process and all of its spawned descendant child processes across platforms.
 *
 * On Windows:
 * Standard `child.kill()` only invokes `TerminateProcess` on the root process (e.g. `cmd.exe`),
 * leaving all subprocesses (node, vitest, webpack, compilers, etc.) running as orphaned background processes.
 * `killProcessTree` uses `taskkill /pid <pid> /T /F` on Win32 to terminate the full tree.
 *
 * On POSIX (Linux / macOS):
 * Attempts process group termination (`process.kill(-pid, signal)`), falling back to direct process kill.
 */
export function killProcessTree(
  childOrPid: ChildProcess | number | undefined,
  signal: "SIGTERM" | "SIGKILL" = "SIGTERM"
): void {
  if (!childOrPid) return;

  const pid =
    typeof childOrPid === "number"
      ? childOrPid
      : typeof childOrPid === "object" && "pid" in childOrPid
        ? childOrPid.pid
        : undefined;

  if (!pid || typeof pid !== "number" || pid <= 0) return;

  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/pid", pid.toString(), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore"
      });
      killer.on("error", () => {
        // Fallback to normal child.kill if taskkill is unavailable
        if (typeof childOrPid !== "number" && typeof childOrPid.kill === "function") {
          try {
            childOrPid.kill(signal);
          } catch {
            // Ignore
          }
        }
      });
    } catch {
      if (typeof childOrPid !== "number" && typeof childOrPid.kill === "function") {
        try {
          childOrPid.kill(signal);
        } catch {
          // Ignore
        }
      }
    }
  } else {
    // POSIX: Attempt process group kill first, then fallback to direct process kill
    try {
      process.kill(-pid, signal);
    } catch {
      if (typeof childOrPid !== "number" && typeof childOrPid.kill === "function") {
        try {
          childOrPid.kill(signal);
        } catch {
          // Ignore
        }
      } else {
        try {
          process.kill(pid, signal);
        } catch {
          // Ignore
        }
      }
    }
  }
}
