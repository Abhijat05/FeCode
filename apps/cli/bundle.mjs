/* global console */
import { build } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const cliDir = path.resolve(repoRoot, "apps/cli");

console.log("Bundling CLI entrypoint...");

// Ensure skills folder is present
const srcSkills = path.resolve(repoRoot, "packages/agent/skills");
const destSkills = path.resolve(cliDir, "skills");
if (fs.existsSync(srcSkills)) {
  fs.cpSync(srcSkills, destSkills, { recursive: true });
}

// Ensure README.md is present with resolved image assets for npm
const rootReadme = path.resolve(repoRoot, "README.md");
const cliReadme = path.resolve(cliDir, "README.md");
if (fs.existsSync(rootReadme)) {
  let content = fs.readFileSync(rootReadme, "utf-8");
  content = content.replaceAll(
    'src="assets/fecode-banner.jpg"',
    'src="https://raw.githubusercontent.com/Abhijat05/FeCode/master/assets/fecode-banner.jpg"'
  );
  fs.writeFileSync(cliReadme, content, "utf-8");
}

await build({
  configFile: false,
  build: {
    target: "node20",
    outDir: path.resolve(cliDir, "dist"),
    emptyOutDir: false,
    lib: {
      entry: path.resolve(cliDir, "src/index.tsx"),
      formats: ["es"],
      fileName: () => "index.js"
    },
    rollupOptions: {
      external: [
        "react",
        "react/jsx-runtime",
        "ink",
        "ink-text-input",
        "@google/genai",
        "openai",
        "dotenv",
        /^node:/,
        "fs",
        "fs/promises",
        "path",
        "os",
        "url",
        "child_process",
        "events",
        "stream",
        "crypto",
        "readline"
      ]
    }
  },
  resolve: {
    alias: {
      "@fecode/agent": path.resolve(repoRoot, "packages/agent/src/index.ts"),
      "@fecode/models": path.resolve(repoRoot, "packages/models/src/index.ts"),
      "@fecode/shared": path.resolve(repoRoot, "packages/shared/src/index.ts")
    }
  }
});

console.log("CLI bundle complete at apps/cli/dist/index.js");
