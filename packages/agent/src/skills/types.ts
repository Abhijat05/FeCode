export type SkillCategory =
  | "frontend"
  | "framework"
  | "styling"
  | "testing"
  | "accessibility"
  | "architecture";

export interface SkillExample {
  title: string;
  description?: string;
  example: string;
}

export interface SkillReference {
  name: string;
  path: string;
  description?: string;
}

export interface SkillActivation {
  when: string[];
  notWhen?: string[];
}

export interface Skill {
  name: string;
  description: string;
  category: SkillCategory;
  version: string;

  activation?: SkillActivation;

  /**
   * Core instructions for the skill.
   */
  instructions: string[];

  /**
   * Step-by-step workflow guidelines.
   */
  workflow?: string[];

  /**
   * Mandatory rules for the skill.
   */
  rules?: string[];

  /**
   * Anti-patterns or tropes to avoid.
   */
  antiPatterns?: string[];

  /**
   * Practical usage examples.
   */
  examples?: SkillExample[];

  /**
   * Reference file paths or documentation metadata.
   */
  references?: SkillReference[];
}

export interface SkillRegistry {
  register(skill: Skill): void;
  get(name: string): Skill | undefined;
  list(): Skill[];
  has(name: string): boolean;
}
