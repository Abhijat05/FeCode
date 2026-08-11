import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { createFrontendTestFixture, type TestFixture } from "./fixtureProject.js";

describe("createFrontendTestFixture", () => {
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createFrontendTestFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("creates a realistic frontend monorepo file structure", async () => {
    const pkgExists = await fs.stat(path.join(fixture.dirPath, "package.json"));
    expect(pkgExists.isFile()).toBe(true);

    const appExists = await fs.stat(path.join(fixture.dirPath, "src", "App.tsx"));
    expect(appExists.isFile()).toBe(true);

    const headerExists = await fs.stat(
      path.join(fixture.dirPath, "src", "components", "DashboardHeader.tsx")
    );
    expect(headerExists.isFile()).toBe(true);
  });
});
