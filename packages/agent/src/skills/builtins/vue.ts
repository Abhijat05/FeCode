import type { Skill } from "../types.js";

export const vueSkill: Skill = {
  name: "vue",
  description: "Vue 3 Composition API, single-file components (<script setup>), and reactivity patterns.",
  category: "framework",
  version: "2.0.0",
  activation: {
    when: ["authoring Vue 3 components", "using Composition API"]
  },
  instructions: [
    "Use Vue 3 Single File Components (.vue) with <script setup lang=\"ts\">.",
    "Declare reactive state using ref() and reactive(), and derived state using computed().",
    "Use defineProps() and defineEmits() for component communication."
  ]
};
