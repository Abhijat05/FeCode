import * as path from "path";
import * as os from "os";

export function getDefaultCheckpointsDir(): string {
  if (process.env.FECODE_CHECKPOINTS_DIR) {
    return path.resolve(process.env.FECODE_CHECKPOINTS_DIR);
  }
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return path.join(os.tmpdir(), "fecode-test-checkpoints");
  }
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "fecode", "checkpoints");
  }
  return path.join(os.homedir(), ".fecode", "checkpoints");
}
