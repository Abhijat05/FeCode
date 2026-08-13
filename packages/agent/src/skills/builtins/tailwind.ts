import type { Skill } from "../types.js";

export const tailwindSkill: Skill = {
  name: "tailwind",
  description: "Tailwind CSS utility composition, responsive modifiers, and state variants.",
  category: "styling",
  version: "2.0.0",
  activation: {
    when: ["styling components with Tailwind CSS", "building responsive layouts"]
  },
  instructions: [
    "Compose layout, typography, and spacing using standard Tailwind utility classes.",
    "Leverage responsive prefixes (sm:, md:, lg:, xl:) for fluid viewport adaptations.",
    "Use interactive state modifiers (hover:, focus:, active:, dark:) cleanly."
  ],
  rules: [
    "Prefer standard Tailwind scale tokens over arbitrary bracket values [h-37px] when standard tokens exist."
  ],
  antiPatterns: [
    "Avoid arbitrary values when scale tokens are available."
  ]
};
