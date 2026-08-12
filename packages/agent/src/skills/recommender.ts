import type { ProjectContext } from "../project/types.js";

export function recommendSkills(projectContext?: ProjectContext): string[] {
  const skills: string[] = [
    "frontend-design",
    "frontend-debugging",
    "accessibility"
  ];

  if (!projectContext) {
    return skills;
  }

  if (projectContext.languages.includes("typescript")) {
    skills.push("typescript-frontend");
  }

  if (projectContext.testing && projectContext.testing.length > 0) {
    skills.push("testing-frontend");
  }

  if (projectContext.framework === "react") {
    skills.push("react");
  } else if (projectContext.framework === "next") {
    skills.push("react");
    skills.push("nextjs");
  } else if (projectContext.framework === "vue" || projectContext.framework === "nuxt") {
    skills.push("vue");
  } else if (projectContext.framework === "svelte" || projectContext.framework === "sveltekit") {
    skills.push("svelte");
  }

  if (projectContext.styling && projectContext.styling.includes("tailwind")) {
    skills.push("tailwind");
  }

  // Remove duplicates while preserving order
  return Array.from(new Set(skills));
}
