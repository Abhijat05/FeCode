import type { Skill } from "../types.js";

export const svelteSkill: Skill = {
  name: "svelte",
  description: "Svelte single-file components, reactive declarations, props, and event handling.",
  category: "framework",
  version: "2.0.0",
  activation: {
    when: ["authoring Svelte components", "handling Svelte reactive statements"]
  },
  instructions: [
    "Write clean Svelte single-file components (.svelte) with script, markup, and scoped style sections.",
    "Declare props using export let, and reactive statements using $: dollar syntax.",
    "Use native DOM event handlers and dispatcher bindings."
  ]
};
