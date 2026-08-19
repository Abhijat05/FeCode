import * as path from "path";
import * as os from "os";

export function getDefaultRecoverySnapshotsDir(): string {
  if (process.env.FECODE_RECOVERY_SNAPSHOTS_DIR) {
    return path.resolve(process.env.FECODE_RECOVERY_SNAPSHOTS_DIR);
  }
  return path.join(os.homedir(), ".fecode", "recovery-snapshots");
}
