import type { Skill, SkillRegistry } from "./types.js";

export class DefaultSkillRegistry implements SkillRegistry {
  private readonly skills: Map<string, Skill> = new Map();

  register(skill: Skill): void {
    if (!skill || !skill.name) {
      throw new Error("Invalid skill object.");
    }
    this.skills.set(skill.name, skill);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }
}
