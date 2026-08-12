import type { Skill, SkillRegistry } from "./types.js";

export interface ResolveActiveSkillsOptions {
  registry: SkillRegistry;
  recommended?: string[];
  userSelected?: string[];
}

export function resolveActiveSkills(options: ResolveActiveSkillsOptions): Skill[] {
  const recommended = options.recommended || [];
  const userSelected = options.userSelected || [];

  const combinedNames = Array.from(new Set([...recommended, ...userSelected]));
  const activeSkills: Skill[] = [];

  for (const name of combinedNames) {
    const skill = options.registry.get(name);
    if (skill) {
      activeSkills.push(skill);
    }
  }

  return activeSkills;
}
