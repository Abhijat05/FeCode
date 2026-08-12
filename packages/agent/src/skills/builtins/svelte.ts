import type { Skill } from "../types.js";

export const svelteSkill: Skill = {
  name: "svelte",
  description: "Svelte single-file components, reactive declarations, props, and event handling.",
  category: "framework",
  version: "1.0.0",
  instructions: `### Skill: Svelte Best Practices
- Write clean Svelte single-file components (.svelte) with script, markup, and scoped style sections.
- Declare props using export let, and reactive statements using $: dollar syntax (or Svelte 5 runes when applicable).
- Use native DOM event handlers and dispatcher bindings.`
};
