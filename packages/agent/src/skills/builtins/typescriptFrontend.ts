import type { Skill } from "../types.js";

export const typescriptFrontendSkill: Skill = {
  name: "typescript-frontend",
  description: "Type safety, component prop contracts, event typing, and clean TypeScript architecture.",
  category: "architecture",
  version: "2.0.0",
  activation: {
    when: ["writing TypeScript components", "typing component props", "handling DOM events"]
  },
  instructions: [
    "Define explicit interface or type contracts for component props and state.",
    "Avoid 'any' type casts; use 'unknown', generics, or discriminated unions for conditional states.",
    "Type synthetic DOM events accurately (e.g. React.ChangeEvent<HTMLInputElement>)."
  ],
  rules: [
    "Verify exact variable names, component prop keys, and method signatures before passing them.",
    "Prevent NullPointerException and ReferenceError crashes by verifying non-null states before dereferencing."
  ],
  antiPatterns: [
    "Avoid using unsafe 'any' assertions to bypass compiler type checks."
  ]
};
