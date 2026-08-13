import type { Skill } from "../types.js";
import { parseSkillMarkdown } from "../parser.js";
import * as fs from "fs";
import * as path from "path";

function loadFrontendDesignSkill(): Skill {
  const possiblePaths = [
    path.resolve(process.cwd(), "packages/agent/skills/frontend-design/SKILL.md"),
    path.resolve(process.cwd(), "skills/frontend-design/SKILL.md"),
    path.resolve(__dirname, "../../../skills/frontend-design/SKILL.md")
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf-8");
      return parseSkillMarkdown(content);
    }
  }

  return {
    name: "frontend-design",
    description: "Visual hierarchy, typography, responsive layout, and clean component composition guidelines.",
    category: "frontend",
    version: "1.0.0",
    activation: {
      when: ["creating UI components", "modifying frontend layouts", "redesigning pages"],
      notWhen: ["backend-only tasks"]
    },
    instructions: [
      "Establish clear visual hierarchy using typography scales, font weights, and contrasting colors.",
      "Maintain consistent spacing and grid alignments using container padding and relative units.",
      "Design responsive, fluid layouts adapting gracefully to desktop, tablet, and mobile viewports."
    ]
  };
}

export const frontendDesignSkill: Skill = loadFrontendDesignSkill();
