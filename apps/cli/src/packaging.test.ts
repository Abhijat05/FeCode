import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { DefaultGitRepository } from "@fecode/agent";

describe("FeCode Packaging & Distribution Verification (Phase 5AH)", () => {
  const repoRoot = path.resolve(__dirname, "../../..");
  const cliDir = path.resolve(repoRoot, "apps/cli");
  const cliDist = path.resolve(cliDir, "dist/index.js");

  it("Executable resolution: CLI entrypoint contains executable shebang", () => {
    expect(fs.existsSync(cliDist)).toBe(true);
    const content = fs.readFileSync(cliDist, "utf-8");
    expect(content.startsWith("#!/usr/bin/env node")).toBe(true);
  });

  it("Binary registration: apps/cli package.json registers fe and fecode bin targets", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(cliDir, "package.json"), "utf-8"));
    expect(pkg.bin).toBeDefined();
    expect(pkg.bin.fe).toBe("./dist/index.js");
    expect(pkg.bin.fecode).toBe("./dist/index.js");
  });

  it("Version flag: --version prints version and exits 0 cleanly", () => {
    const output = execSync(`node "${cliDist}" --version`, {
      encoding: "utf-8",
      cwd: cliDir
    }).trim();

    expect(output).toBe("1.0.0");
  });

  it("Version flag: -v shorthand prints version and exits 0 cleanly", () => {
    const output = execSync(`node "${cliDist}" -v`, {
      encoding: "utf-8",
      cwd: cliDir
    }).trim();

    expect(output).toBe("1.0.0");
  });

  it("Help flag: --help prints comprehensive CLI usage and exits 0 cleanly", () => {
    const output = execSync(`node "${cliDist}" --help`, {
      encoding: "utf-8",
      cwd: cliDir
    });

    expect(output).toContain("FeCode - Interactive Terminal Coding Assistant");
    expect(output).toContain("Usage:");
    expect(output).toContain("fe [options]");
    expect(output).toContain("fecode [options]");
    expect(output).toContain("-v, --version");
    expect(output).toContain("-h, --help");
    expect(output).toContain("-r, --resume <id>");
    expect(output).toContain("FE_PROVIDER");
    expect(output).toContain("GEMINI_API_KEY");
    expect(output).toContain("OPENAI_API_KEY");
  });

  it("Help flag: -h shorthand prints usage instructions", () => {
    const output = execSync(`node "${cliDist}" -h`, {
      encoding: "utf-8",
      cwd: cliDir
    });

    expect(output).toContain("FeCode - Interactive Terminal Coding Assistant");
    expect(output).toContain("Interactive Commands (inside TUI):");
    expect(output).toContain("/plan");
    expect(output).toContain("/replan");
  });

  it("Package boundary: all monorepo packages define clean files boundaries", () => {
    const packages = [
      "apps/cli",
      "packages/agent",
      "packages/models",
      "packages/shared"
    ];

    for (const pkgRel of packages) {
      const pkgPath = path.resolve(repoRoot, pkgRel, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      expect(pkg.files).toBeDefined();
      expect(Array.isArray(pkg.files)).toBe(true);
      expect(pkg.files.some((f: string) => f.includes("dist"))).toBe(true);
      // Verify map files are excluded from publishing
      expect(pkg.files.some((f: string) => f.includes("!dist/**/*.map"))).toBe(true);
    }
  });

  it("Package boundary: apps/cli/dist contains zero test files", () => {
    const distDir = path.resolve(cliDir, "dist");
    expect(fs.existsSync(distDir)).toBe(true);

    const checkDir = (dir: string): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const testFiles: string[] = [];
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          testFiles.push(...checkDir(full));
        } else if (entry.name.includes(".test.")) {
          testFiles.push(full);
        }
      }
      return testFiles;
    };

    const foundTests = checkDir(distDir);
    expect(foundTests).toEqual([]);
  });

  it("Skills distribution: packages/agent includes skills directory in package files", () => {
    const agentPkg = JSON.parse(fs.readFileSync(path.resolve(repoRoot, "packages/agent/package.json"), "utf-8"));
    expect(agentPkg.files).toContain("skills");
    const skillsDir = path.resolve(repoRoot, "packages/agent/skills");
    expect(fs.existsSync(skillsDir)).toBe(true);
    const skillDirs = fs.readdirSync(skillsDir);
    expect(skillDirs.length).toBeGreaterThanOrEqual(10);
  });

  it("Runtime engine requirements: all packages declare Node.js >= 20.0.0", () => {
    const packages = [
      "package.json",
      "apps/cli/package.json",
      "packages/agent/package.json",
      "packages/models/package.json",
      "packages/shared/package.json"
    ];

    for (const rel of packages) {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(repoRoot, rel), "utf-8"));
      if (rel !== "package.json") {
        expect(pkg.engines).toBeDefined();
        expect(pkg.engines.node).toBe(">=20.0.0");
      }
    }

    const currentMajor = parseInt(process.versions.node.split(".")[0], 10);
    expect(currentMajor).toBeGreaterThanOrEqual(20);
  });

  it("Distribution tarballs: generated release tarballs contain zero secrets or git files", () => {
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    const packages = ["packages/agent", "packages/models", "packages/shared", "apps/cli"];
    const generatedTarballs: string[] = [];

    try {
      for (const workspace of packages) {
        const output = execSync(
          `${npmCommand} pack --workspace=${workspace} --pack-destination="${repoRoot}" --json`,
          { cwd: repoRoot, encoding: "utf-8" }
        );
        const [result] = JSON.parse(output) as Array<{ filename: string }>;
        generatedTarballs.push(result.filename);
      }

      expect(generatedTarballs.length).toBeGreaterThanOrEqual(4);

      for (const tgz of generatedTarballs) {
        const tgzPath = path.resolve(repoRoot, tgz);
        const list = execSync(`tar -tzf "${tgzPath}"`, { encoding: "utf-8" });
        expect(list).not.toContain(".env");
        expect(list).not.toContain(".git");
        expect(list).not.toContain(".npmrc");
        expect(list).not.toContain("id_rsa");
      }
    } finally {
      for (const tgz of generatedTarballs) {
        fs.rmSync(path.resolve(repoRoot, tgz), { force: true });
      }
    }
  }, 30000);

  it("Graceful Git fallback: non-git directory falls back safely without throwing", async () => {
    const tempNonGit = fs.mkdtempSync(path.join(os.tmpdir(), "fecode-nongit-"));
    try {
      const git = new DefaultGitRepository();
      const isRepo = await git.isRepository(tempNonGit);
      expect(isRepo).toBe(false);
      const branch = await git.getBranch(tempNonGit);
      expect(branch).toBeNull();
      const status = await git.getStatus(tempNonGit);
      expect(status.isRepository).toBe(false);
      expect(status.files).toEqual([]);
    } finally {
      fs.rmSync(tempNonGit, { recursive: true, force: true });
    }
  });

  it("Non-TTY handling: launching in non-interactive environment exits with clear notice without stack trace", () => {
    try {
      execSync(`node "${cliDist}"`, {
        cwd: cliDir,
        env: { ...process.env, VITEST: "" },
        stdio: ["pipe", "pipe", "pipe"]
      });
      expect.fail("Should have exited with code 1");
    } catch (err: unknown) {
      const execErr = err as { status?: number; stderr?: Buffer | string };
      expect(execErr.status).toBe(1);
      const stderr = String(execErr.stderr || "");
      expect(stderr).toContain("FeCode requires an interactive terminal (TTY)");
      expect(stderr).not.toContain("Raw mode is not supported");
    }
  });
});
