/* global console, process */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const cliDir = path.resolve(repoRoot, "apps/cli");

console.log("=== FeCode CLI Smoke Test: Verifying npm pack & binary ===");

// 1. Read expected CLI version from apps/cli/package.json
const pkgJson = JSON.parse(fs.readFileSync(path.join(cliDir, "package.json"), "utf8"));
const expectedVersion = pkgJson.version;
console.log(`Target CLI version: ${expectedVersion}`);

// 2. Ensure apps/cli/dist/index.js exists
const bundlePath = path.join(cliDir, "dist/index.js");
if (!fs.existsSync(bundlePath)) {
  console.error(`ERROR: Bundle entrypoint missing at ${bundlePath}. Did you run npm run build?`);
  process.exit(1);
}

// 3. Run npm pack inside apps/cli to produce a tarball
console.log("Packing apps/cli via npm pack...");
const packOutput = execSync("npm pack --json", { cwd: cliDir, encoding: "utf8" });
const packInfo = JSON.parse(packOutput);
const tarballName = packInfo[0]?.filename;

if (!tarballName) {
  console.error("ERROR: Failed to obtain tarball name from npm pack output.");
  process.exit(1);
}

const tarballPath = path.resolve(cliDir, tarballName);
console.log(`Generated tarball: ${tarballPath}`);

// 4. Create an isolated temporary test directory
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fecode-smoke-"));
console.log(`Created isolated test environment at: ${tempDir}`);

try {
  // Initialize dummy package.json in tempDir
  fs.writeFileSync(
    path.join(tempDir, "package.json"),
    JSON.stringify({ name: "smoke-test", private: true }, null, 2),
    "utf8"
  );

  // Install the packaged tarball in the isolated directory
  console.log(`Installing ${tarballName} in temp environment...`);
  execSync(`npm install "${tarballPath}"`, { cwd: tempDir, stdio: "inherit" });

  // 5. Test executing the installed CLI binary
  const installedEntry = path.join(tempDir, "node_modules/fecode-cli/dist/index.js");
  if (!fs.existsSync(installedEntry)) {
    console.error(`ERROR: Installed entrypoint missing at ${installedEntry}`);
    process.exit(1);
  }

  console.log("Executing installed CLI entrypoint: fecode --version...");
  const versionOutput = execSync(`node "${installedEntry}" --version`, {
    cwd: tempDir,
    encoding: "utf8"
  }).trim();
  console.log(`Got version output: "${versionOutput}"`);

  if (!versionOutput.includes(expectedVersion)) {
    console.error(`ERROR: Expected version "${expectedVersion}", received "${versionOutput}"`);
    process.exit(1);
  }

  console.log("Executing installed CLI entrypoint: fecode --help...");
  const helpOutput = execSync(`node "${installedEntry}" --help`, {
    cwd: tempDir,
    encoding: "utf8"
  });

  if (!helpOutput.includes("Usage") && !helpOutput.includes("Options") && !helpOutput.includes("Available Commands")) {
    console.error("ERROR: fecode --help did not output expected help information.");
    process.exit(1);
  }

  // Also test .bin shim if available
  const binShim = path.join(tempDir, "node_modules/.bin", process.platform === "win32" ? "fecode.cmd" : "fecode");
  if (fs.existsSync(binShim)) {
    console.log(`Testing binary shim at ${binShim}...`);
    const shimVersion = execSync(`"${binShim}" --version`, { cwd: tempDir, encoding: "utf8" }).trim();
    if (!shimVersion.includes(expectedVersion)) {
      console.error(`ERROR: Bin shim version mismatch: got "${shimVersion}", expected "${expectedVersion}"`);
      process.exit(1);
    }
  }

  console.log("SUCCESS: All CLI packaging smoke checks passed cleanly!");
} finally {
  // Clean up tarball and temp directory
  try {
    fs.rmSync(tarballPath, { force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (err) {
    console.warn("Cleanup warning:", err.message);
  }
}
