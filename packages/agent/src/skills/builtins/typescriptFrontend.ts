import type { Skill } from "../types.js";

export const typescriptFrontendSkill: Skill = {
  name: "typescript-frontend",
  description: "Type safety, component prop contracts, event typing, and clean TypeScript architecture.",
  category: "architecture",
  version: "1.0.0",
  instructions: `### Skill: TypeScript Frontend Best Practices
- Define explicit interface or type contracts for component props and state.
- Avoid 'any' type casts; use 'unknown', generics, or discriminated unions for conditional states.
- Type synthetic DOM events accurately (e.g. React.ChangeEvent<HTMLInputElement>).
- Maintain strict type checking compatibility without overengineering type definitions.`
};
