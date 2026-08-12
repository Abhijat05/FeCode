import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { ProjectDetector } from "./detector.js";

describe("ProjectDetector", () => {
  let tmpDir: string;
  let detector: ProjectDetector;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-project-test-"));
    detector = new ProjectDetector();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("detects React + Vite + TypeScript + Tailwind + Vitest + npm project", async () => {
    const packageJson = {
      name: "react-vite-app",
      dependencies: {
        react: "^18.3.1",
        "react-dom": "^18.3.1"
      },
      devDependencies: {
        typescript: "^5.7.2",
        vite: "^5.4.0",
        tailwindcss: "^3.4.0",
        vitest: "^2.1.0"
      }
    };

    await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify(packageJson, null, 2));
    await fs.writeFile(path.join(tmpDir, "package-lock.json"), "{}");
    await fs.writeFile(path.join(tmpDir, "tsconfig.json"), "{}");
    await fs.writeFile(path.join(tmpDir, "vite.config.ts"), "export default {};");
    await fs.writeFile(path.join(tmpDir, "tailwind.config.js"), "module.exports = {};");
    await fs.mkdir(path.join(tmpDir, "src", "components"), { recursive: true });

    const ctx = await detector.detect(tmpDir);

    expect(ctx.framework).toBe("react");
    expect(ctx.buildTool).toBe("vite");
    expect(ctx.packageManager).toBe("npm");
    expect(ctx.languages).toContain("typescript");
    expect(ctx.styling).toContain("tailwind");
    expect(ctx.testing).toContain("vitest");
    expect(ctx.sourceDirectories).toContain("src");
    expect(ctx.componentDirectories).toContain("src/components");
    expect(ctx.configFiles).toContain("vite.config.ts");
    expect(ctx.configFiles).toContain("tailwind.config.js");
  });

  it("detects Next.js + React + Tailwind + Playwright + pnpm project", async () => {
    const packageJson = {
      name: "next-app",
      dependencies: {
        next: "14.2.0",
        react: "18.3.1",
        "react-dom": "18.3.1"
      },
      devDependencies: {
        typescript: "^5.7.2",
        tailwindcss: "^3.4.0",
        "@playwright/test": "^1.40.0"
      }
    };

    await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify(packageJson, null, 2));
    await fs.writeFile(path.join(tmpDir, "pnpm-lock.yaml"), "lockfileVersion: 5.4");
    await fs.writeFile(path.join(tmpDir, "next.config.js"), "module.exports = {};");
    await fs.mkdir(path.join(tmpDir, "app"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "components"), { recursive: true });

    const ctx = await detector.detect(tmpDir);

    expect(ctx.framework).toBe("next");
    expect(ctx.frameworkVersion).toBe("14.2.0");
    expect(ctx.buildTool).toBe("next");
    expect(ctx.packageManager).toBe("pnpm");
    expect(ctx.languages).toContain("typescript");
    expect(ctx.styling).toContain("tailwind");
    expect(ctx.testing).toContain("playwright");
    expect(ctx.sourceDirectories).toContain("app");
    expect(ctx.componentDirectories).toContain("components");
  });

  it("detects Vue + Vite + JavaScript + yarn project", async () => {
    const packageJson = {
      name: "vue-app",
      dependencies: {
        vue: "^3.4.0"
      },
      devDependencies: {
        vite: "^5.4.0"
      }
    };

    await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify(packageJson, null, 2));
    await fs.writeFile(path.join(tmpDir, "yarn.lock"), "# yarn lockfile");

    const ctx = await detector.detect(tmpDir);

    expect(ctx.framework).toBe("vue");
    expect(ctx.buildTool).toBe("vite");
    expect(ctx.packageManager).toBe("yarn");
    expect(ctx.languages).toContain("javascript");
    expect(ctx.languages).not.toContain("typescript");
  });

  it("detects SvelteKit + Vite + bun project", async () => {
    const packageJson = {
      name: "svelte-app",
      devDependencies: {
        "@sveltejs/kit": "^2.0.0",
        svelte: "^4.0.0",
        vite: "^5.0.0"
      }
    };

    await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify(packageJson, null, 2));
    await fs.writeFile(path.join(tmpDir, "bun.lockb"), "bun lockfile");

    const ctx = await detector.detect(tmpDir);

    expect(ctx.framework).toBe("sveltekit");
    expect(ctx.buildTool).toBe("vite");
    expect(ctx.packageManager).toBe("bun");
  });

  it("handles unknown/empty projects without crashing", async () => {
    const ctx = await detector.detect(tmpDir);

    expect(ctx.projectRoot).toBe(tmpDir);
    expect(ctx.framework).toBeNull();
    expect(ctx.buildTool).toBeNull();
    expect(ctx.packageManager).toBeNull();
    expect(ctx.sourceDirectories).toEqual([]);
    expect(ctx.componentDirectories).toEqual([]);
  });

  it("detects package manager from lockfiles reliably", async () => {
    await fs.writeFile(path.join(tmpDir, "package.json"), "{}");

    await fs.writeFile(path.join(tmpDir, "pnpm-lock.yaml"), "");
    const ctxPnpm = await detector.detect(tmpDir);
    expect(ctxPnpm.packageManager).toBe("pnpm");
    await fs.rm(path.join(tmpDir, "pnpm-lock.yaml"));

    await fs.writeFile(path.join(tmpDir, "yarn.lock"), "");
    const ctxYarn = await detector.detect(tmpDir);
    expect(ctxYarn.packageManager).toBe("yarn");
    await fs.rm(path.join(tmpDir, "yarn.lock"));

    await fs.writeFile(path.join(tmpDir, "bun.lock"), "");
    const ctxBun = await detector.detect(tmpDir);
    expect(ctxBun.packageManager).toBe("bun");
    await fs.rm(path.join(tmpDir, "bun.lock"));

    await fs.writeFile(path.join(tmpDir, "package-lock.json"), "{}");
    const ctxNpm = await detector.detect(tmpDir);
    expect(ctxNpm.packageManager).toBe("npm");
  });

  it("does not falsely claim frameworks when evidence is ambiguous", async () => {
    const packageJson = {
      name: "custom-library",
      dependencies: {
        lodash: "^4.17.21"
      }
    };
    await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify(packageJson));

    const ctx = await detector.detect(tmpDir);
    expect(ctx.framework).toBeNull();
    expect(ctx.buildTool).toBeNull();
  });

  it("detects FeCode monorepo repository correctly", async () => {
    const feCodeRoot = path.resolve(process.cwd());
    const ctx = await detector.detect(feCodeRoot);

    expect(ctx.languages).toContain("typescript");
    expect(ctx.packageManager).toBe("npm");
    expect(ctx.testing).toContain("vitest");
    expect(ctx.configFiles).toContain("package.json");
  });
});
