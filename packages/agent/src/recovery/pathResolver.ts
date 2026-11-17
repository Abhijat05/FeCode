import * as path from "path";
import * as os from "os";

export function getDefaultRecoverySnapshotsDir(): string {
  if (process.env.FECODE_RECOVERY_SNAPSHOTS_DIR) {
    return path.resolve(process.env.FECODE_RECOVERY_SNAPSHOTS_DIR);
  }
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return path.join(os.tmpdir(), "fecode-test-recovery-snapshots");
  }
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "fecode", "recovery-snapshots");
  }
  return path.join(os.homedir(), ".fecode", "recovery-snapshots");
}
