export type SkillCategory =
  | "frontend"
  | "framework"
  | "styling"
  | "testing"
  | "accessibility"
  | "architecture";

export interface Skill {
  name: string;
  description: string;
  category: SkillCategory;
  version: string;
  instructions: string;
}

export interface SkillRegistry {
  register(skill: Skill): void;
  get(name: string): Skill | undefined;
  list(): Skill[];
  has(name: string): boolean;
}
