import type { SkillRegistry } from "../types.js";
import { frontendDesignSkill } from "./frontendDesign.js";
import { frontendDebuggingSkill } from "./frontendDebugging.js";
import { accessibilitySkill } from "./accessibility.js";
import { typescriptFrontendSkill } from "./typescriptFrontend.js";
import { testingFrontendSkill } from "./testingFrontend.js";
import { reactSkill } from "./react.js";
import { nextjsSkill } from "./nextjs.js";
import { vueSkill } from "./vue.js";
import { svelteSkill } from "./svelte.js";
import { tailwindSkill } from "./tailwind.js";

export * from "./frontendDesign.js";
export * from "./frontendDebugging.js";
export * from "./accessibility.js";
export * from "./typescriptFrontend.js";
export * from "./testingFrontend.js";
export * from "./react.js";
export * from "./nextjs.js";
export * from "./vue.js";
export * from "./svelte.js";
export * from "./tailwind.js";

export const BUILTIN_SKILLS = [
  frontendDesignSkill,
  frontendDebuggingSkill,
  accessibilitySkill,
  typescriptFrontendSkill,
  testingFrontendSkill,
  reactSkill,
  nextjsSkill,
  vueSkill,
  svelteSkill,
  tailwindSkill
];

export function registerBuiltinSkills(registry: SkillRegistry): void {
  for (const skill of BUILTIN_SKILLS) {
    registry.register(skill);
  }
}
