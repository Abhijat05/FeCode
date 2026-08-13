import { describe, it, expect } from "vitest";
import { parseSkillMarkdown } from "./parser.js";

describe("parseSkillMarkdown", () => {
  it("parses valid SKILL.md frontmatter and markdown sections into runtime Skill object", () => {
    const markdown = `---
name: frontend-design
description: Visual hierarchy and layout guidelines.
category: frontend
version: 1.0.0
---

# Frontend Design

## When to use
- creating UI components
- modifying frontend layouts

## When not to use
- backend API design

## Instructions
- Establish clear visual hierarchy.
- Maintain consistent spacing.

## Workflow
1. Analyze primary UI utility.
2. Establish layout grid.

## Rules
- Every interactive element must have focus states.

## Avoid
- Unconstrained massive typography.

## Examples
### Responsive Card
Use standard spacing utility classes.
\`\`\`tsx
<div className="p-4">Card</div>
\`\`\`

## References
- Typography: references/typography.md (Font guidance)
`;

    const skill = parseSkillMarkdown(markdown);

    expect(skill.name).toBe("frontend-design");
    expect(skill.description).toBe("Visual hierarchy and layout guidelines.");
    expect(skill.category).toBe("frontend");
    expect(skill.version).toBe("1.0.0");

    expect(skill.activation?.when).toEqual(["creating UI components", "modifying frontend layouts"]);
    expect(skill.activation?.notWhen).toEqual(["backend API design"]);
    expect(skill.instructions).toEqual(["Establish clear visual hierarchy.", "Maintain consistent spacing."]);
    expect(skill.workflow).toEqual(["1. Analyze primary UI utility.", "2. Establish layout grid."]);
    expect(skill.rules).toEqual(["Every interactive element must have focus states."]);
    expect(skill.antiPatterns).toEqual(["Unconstrained massive typography."]);

    expect(skill.examples).toHaveLength(1);
    expect(skill.examples?.[0].title).toBe("Responsive Card");
    expect(skill.examples?.[0].example).toContain("<div className=\"p-4\">Card</div>");

    expect(skill.references).toHaveLength(1);
    expect(skill.references?.[0].name).toBe("Typography");
    expect(skill.references?.[0].path).toBe("references/typography.md");
  });

  it("loads a minimal SKILL.md with only frontmatter and instructions", () => {
    const markdown = `---
name: minimal-skill
description: Minimal test skill
category: testing
version: 1.0.0
---

## Instructions
- Write clean unit tests.
`;

    const skill = parseSkillMarkdown(markdown);

    expect(skill.name).toBe("minimal-skill");
    expect(skill.instructions).toEqual(["Write clean unit tests."]);
    expect(skill.workflow).toBeUndefined();
    expect(skill.rules).toBeUndefined();
  });

  it("tolerates unknown markdown sections without crashing or corrupting known sections", () => {
    const markdown = `---
name: test-skill
description: Test skill
category: architecture
version: 1.0.0
---

## Instructions
- Valid instruction.

## Custom Unknown Section
- Unknown content.
`;

    const skill = parseSkillMarkdown(markdown);

    expect(skill.name).toBe("test-skill");
    expect(skill.instructions).toEqual(["Valid instruction."]);
  });

  it("throws structured error when frontmatter name, description, category, or version is missing", () => {
    const missingName = `---
description: Test skill
category: frontend
version: 1.0.0
---
## Instructions
- Test
`;

    expect(() => parseSkillMarkdown(missingName)).toThrow("Frontmatter field 'name' is required");

    const invalidCategory = `---
name: test
description: Test
category: invalid-category
version: 1.0.0
---
## Instructions
- Test
`;

    expect(() => parseSkillMarkdown(invalidCategory)).toThrow("Invalid category 'invalid-category'");
  });
});
