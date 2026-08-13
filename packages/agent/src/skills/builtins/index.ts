import type { SkillRegistry } from "../types.js";
import { frontendDesignSkill } from "./frontendDesign.js";
import { typescriptFrontendSkill } from "./typescriptFrontend.js";

export * from "./frontendDesign.js";
export * from "./typescriptFrontend.js";

export const BUILTIN_SKILLS = [
  frontendDesignSkill,
  typescriptFrontendSkill
];

export function registerBuiltinSkills(registry: SkillRegistry): void {
  for (const skill of BUILTIN_SKILLS) {
    registry.register(skill);
  }
}
