import * as path from "path";
import * as os from "os";

export function getDefaultCheckpointsDir(): string {
  if (process.env.FECODE_CHECKPOINTS_DIR) {
    return path.resolve(process.env.FECODE_CHECKPOINTS_DIR);
  }
  return path.join(os.homedir(), ".fecode", "checkpoints");
}
