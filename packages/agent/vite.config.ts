import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@fecode/agent": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      "@fecode/models": fileURLToPath(new URL("../models/src/index.ts", import.meta.url)),
      "@fecode/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url))
    }
  }
});