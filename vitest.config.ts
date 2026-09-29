import * as os from "os";
import * as path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    env: {
      FECODE_HISTORY_DIR: path.join(os.tmpdir(), "fecode-test-history")
    }
  }
});

