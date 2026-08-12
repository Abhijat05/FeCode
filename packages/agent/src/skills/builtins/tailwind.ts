import type { Skill } from "../types.js";

export const tailwindSkill: Skill = {
  name: "tailwind",
  description: "Tailwind CSS utility composition, responsive modifiers, and state variants.",
  category: "styling",
  version: "1.0.0",
  instructions: `### Skill: Tailwind CSS Guidelines
- Compose layout, typography, and spacing using standard Tailwind utility classes.
- Leverage responsive prefixes (sm:, md:, lg:, xl:) for fluid viewport adaptations.
- Use interactive state modifiers (hover:, focus:, active:, dark:) cleanly.
- Prefer standard Tailwind scale tokens over arbitrary bracket values [h-37px] when standard tokens exist.
- Group utility classes logically (layout → flex/grid → spacing → sizing → typography → visual).`
};
