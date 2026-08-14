import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { ProjectDetector } from "./detector.js";

describe("ProjectDetector - Phase 4C.2 Fixtures", () => {
  let tmpDir: string;
  let detector: ProjectDetector;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-project-test-"));
    detector = new ProjectDetector();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("Fixture A: React + Vite Structure", async () => {
    const packageJson = {
      dependencies: { react: "^18.0.0" },
      devDependencies: { vite: "^5.0.0" },
      scripts: {
        dev: "vite",
        build: "vite build",
        test: "vitest"
      }
    };
    await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify(packageJson));
    await fs.writeFile(path.join(tmpDir, "vite.config.ts"), "");
    
    // Create directories
    await fs.mkdir(path.join(tmpDir, "src/components"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "src/hooks"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "tests"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "public"), { recursive: true });
    
    const ctx = await detector.detect(tmpDir);
    expect(ctx.projectType).toBe("frontend");
    
    // Structure
    expect(ctx.structure.sourceDirectories).toContain("src");
    expect(ctx.structure.sourceDirectories).toContain("src/hooks");
    expect(ctx.structure.sourceDirectories).toContain("public");
    expect(ctx.structure.sourceDirectories).toContain("tests");
    expect(ctx.structure.componentDirectories).toContain("src/components");
    expect(ctx.structure.testDirectories).toContain("tests");
    expect(ctx.structure.assetDirectories).toContain("public");
    
    // Scripts
    expect(ctx.scripts.dev).toBe("vite");
    expect(ctx.scripts.build).toBe("vite build");
    expect(ctx.scripts.test).toBe("vitest");
    expect(ctx.scripts.lint).toBeUndefined();
    
    // Configuration
    expect(ctx.configuration.build).toContain("vite.config.ts");
  });

  it("Fixture B: Next.js Structure", async () => {
    const packageJson = {
      dependencies: { next: "14.0.0", react: "18.0.0" },
      scripts: { dev: "next dev" }
    };
    await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify(packageJson));
    await fs.writeFile(path.join(tmpDir, "next.config.js"), "");

    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "app"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "components"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "public"), { recursive: true });

    const ctx = await detector.detect(tmpDir);
    
    expect(ctx.structure.sourceDirectories).toContain("src");
    expect(ctx.structure.sourceDirectories).toContain("app");
    expect(ctx.structure.sourceDirectories).toContain("components");
    expect(ctx.structure.sourceDirectories).toContain("public");
    expect(ctx.structure.componentDirectories).toContain("components");
    expect(ctx.structure.routeDirectories).toContain("app");
    expect(ctx.structure.assetDirectories).toContain("public");

    expect(ctx.scripts.dev).toBe("next dev");
    expect(ctx.configuration.framework).toContain("next.config.js");
  });

  it("Fixture C: Vue Structure", async () => {
    const packageJson = {
      dependencies: { vue: "^3.0.0" }
    };
    await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify(packageJson));

    await fs.mkdir(path.join(tmpDir, "src/components"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "src/pages"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "src/router"), { recursive: true });

    const ctx = await detector.detect(tmpDir);
    expect(ctx.structure.sourceDirectories).toContain("src");
    expect(ctx.structure.componentDirectories).toContain("src/components");
    expect(ctx.structure.routeDirectories).toContain("src/pages");
    expect(ctx.structure.routeDirectories).toContain("src/router");
  });

  it("Fixture D: SvelteKit Structure", async () => {
    const packageJson = {
      devDependencies: { "@sveltejs/kit": "^2.0.0" }
    };
    await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify(packageJson));

    await fs.mkdir(path.join(tmpDir, "src/routes"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "src/lib"), { recursive: true });

    const ctx = await detector.detect(tmpDir);
    expect(ctx.structure.sourceDirectories).toContain("src");
    expect(ctx.structure.routeDirectories).toContain("src/routes");
    // Note: lib is explicitly mapped in sourceDirectories according to our candidate list
    expect(ctx.structure.sourceDirectories).toContain("src/lib"); 
  });

  it("Fixture E: Project with no conventional structure", async () => {
    const packageJson = { name: "weird-project" };
    await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify(packageJson));
    await fs.mkdir(path.join(tmpDir, "weird_dir"), { recursive: true });

    const ctx = await detector.detect(tmpDir);
    expect(ctx.structure.sourceDirectories).toEqual([]);
    expect(ctx.structure.componentDirectories).toEqual([]);
    expect(ctx.structure.routeDirectories).toEqual([]);
    expect(ctx.structure.testDirectories).toEqual([]);
    expect(ctx.structure.assetDirectories).toEqual([]);
    expect(ctx.scripts).toEqual({});
  });

  it("Fixture F: Missing scripts shouldn't invent them", async () => {
    const packageJson = { name: "no-scripts" };
    await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify(packageJson));
    const ctx = await detector.detect(tmpDir);
    expect(ctx.scripts).toEqual({});
  });

  it("Safety: credentials/.env and boundary test", async () => {
    await fs.writeFile(path.join(tmpDir, ".env"), "SECRET_KEY=1234567890");
    await fs.writeFile(path.join(tmpDir, "package.json"), "{}");
    
    // Also create some git and node modules
    await fs.mkdir(path.join(tmpDir, ".git"));
    await fs.mkdir(path.join(tmpDir, "node_modules"));
    await fs.writeFile(path.join(tmpDir, "node_modules", "secret.key"), "PRIVATE KEY");
    
    const ctx = await detector.detect(tmpDir);
    
    const serialized = JSON.stringify(ctx);
    expect(serialized).not.toContain("SECRET_KEY");
    expect(serialized).not.toContain("1234567890");
    expect(serialized).not.toContain("PRIVATE KEY");
  });
});
