import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { SkillLoader } from "./loader.js";
import { DefaultSkillRegistry } from "./registry.js";

describe("SkillLoader", () => {
  let tmpDir: string;
  let loader: SkillLoader;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-skill-loader-"));
    loader = new SkillLoader();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("loads a valid SKILL.md from a file path", async () => {
    const filePath = path.join(tmpDir, "SKILL.md");
    await fs.writeFile(
      filePath,
      `---
name: test-skill
description: Test description
category: frontend
version: 1.0.0
---

## Instructions
- Test instruction
`
    );

    const skill = await loader.loadSkillFromFile(filePath, tmpDir);
    expect(skill.name).toBe("test-skill");
    expect(skill.instructions).toEqual(["Test instruction"]);
  });

  it("loads a SKILL.md from a skill directory", async () => {
    const skillDir = path.join(tmpDir, "skills", "react-skill");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: react-skill
description: React skill description
category: framework
version: 1.0.0
---

## Instructions
- Use hooks
`
    );

    const skill = await loader.loadSkillFromDir(skillDir, tmpDir);
    expect(skill.name).toBe("react-skill");
    expect(skill.category).toBe("framework");
  });

  it("discovers skills deterministically from root skills directory while skipping dirs without SKILL.md", async () => {
    const skillsRoot = path.join(tmpDir, "skills");

    // Skill 1: react
    const reactDir = path.join(skillsRoot, "react");
    await fs.mkdir(reactDir, { recursive: true });
    await fs.writeFile(
      path.join(reactDir, "SKILL.md"),
      `---
name: react
description: React guidelines
category: framework
version: 1.0.0
---
## Instructions
- React rule
`
    );

    // Skill 2: accessibility
    const a11yDir = path.join(skillsRoot, "accessibility");
    await fs.mkdir(a11yDir, { recursive: true });
    await fs.writeFile(
      path.join(a11yDir, "SKILL.md"),
      `---
name: accessibility
description: Accessibility guidelines
category: accessibility
version: 1.0.0
---
## Instructions
- A11y rule
`
    );

    // Directory without SKILL.md (should be ignored)
    const emptyDir = path.join(skillsRoot, "empty-dir");
    await fs.mkdir(emptyDir, { recursive: true });

    const discovered = await loader.discoverSkills(skillsRoot);
    expect(discovered).toHaveLength(2);
    // Deterministic sort by name
    expect(discovered.map((s) => s.name)).toEqual(["accessibility", "react"]);
  });

  it("rejects path traversal attempts outside root boundary", async () => {
    await expect(
      loader.loadSkillFromFile(path.join(tmpDir, "../../etc/passwd"), tmpDir)
    ).rejects.toThrow();
  });

  it("allows loaded SKILL.md object to be registered in SkillRegistry", async () => {
    const filePath = path.join(tmpDir, "SKILL.md");
    await fs.writeFile(
      filePath,
      `---
name: registry-test-skill
description: Registry test skill
category: testing
version: 1.0.0
---

## Instructions
- Registry test instruction
`
    );

    const skill = await loader.loadSkillFromFile(filePath, tmpDir);
    const registry = new DefaultSkillRegistry();
    registry.register(skill);

    expect(registry.has("registry-test-skill")).toBe(true);
    expect(registry.get("registry-test-skill")).toEqual(skill);
  });

  it("loads canonical frontend-design/SKILL.md proof of concept file cleanly", async () => {
    const canonicalPath = path.resolve(process.cwd(), "packages/agent/skills/frontend-design/SKILL.md");
    const skill = await loader.loadSkillFromFile(canonicalPath);

    // Frontmatter
    expect(skill.name).toBe("frontend-design");
    expect(skill.category).toBe("frontend");
    expect(skill.version).toBe("2.0.0");
    expect(skill.description).toBeTruthy();
    expect(skill.description.length).toBeGreaterThan(30);

    // Activation
    expect(skill.activation?.when.length).toBeGreaterThan(0);
    expect(skill.activation?.notWhen?.length).toBeGreaterThan(0);

    // Core instructions present and non-trivial
    expect(skill.instructions.length).toBeGreaterThan(2);

    // Major workflow and rules sections present
    expect(skill.workflow?.length).toBeGreaterThan(0);
    expect(skill.rules?.length).toBeGreaterThan(0);

    // Anti-patterns section present (AI-slop avoidance)
    expect(skill.antiPatterns?.length).toBeGreaterThan(0);

    // Examples present
    expect(skill.examples?.length).toBeGreaterThan(0);
  });
});
