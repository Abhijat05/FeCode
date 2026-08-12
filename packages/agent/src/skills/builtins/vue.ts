import type { Skill } from "../types.js";

export const vueSkill: Skill = {
  name: "vue",
  description: "Vue 3 Composition API, single-file components (<script setup>), and reactivity patterns.",
  category: "framework",
  version: "1.0.0",
  instructions: `### Skill: Vue 3 Best Practices
- Use Vue 3 Single File Components (.vue) with <script setup lang="ts">.
- Declare reactive state using ref() and reactive(), and derived state using computed().
- Use defineProps() and defineEmits() for component communication.
- Leverage v-bind, v-model, and directive bindings cleanly.`
};
