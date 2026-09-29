import * as path from "path";
import * as os from "os";

export function getDefaultHistoryDir(): string {
  if (process.env.FECODE_HISTORY_DIR) {
    return path.resolve(process.env.FECODE_HISTORY_DIR);
  }
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return path.join(os.tmpdir(), "fecode-test-history");
  }
  return path.join(os.homedir(), ".fecode", "history");
}

