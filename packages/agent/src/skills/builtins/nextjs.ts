import type { Skill } from "../types.js";

export const nextjsSkill: Skill = {
  name: "nextjs",
  description: "Next.js App Router, Server/Client component separation, routing, and data fetching.",
  category: "framework",
  version: "2.0.0",
  activation: {
    when: ["building Next.js App Router pages", "authoring Server/Client components"]
  },
  instructions: [
    "Distinguish between React Server Components (default in App Router) and Client Components ('use client').",
    "Keep 'use client' directives as close to the leaf interactive components as possible.",
    "Use Next.js metadata API for head tags and SEO management."
  ],
  workflow: [
    "1. Define server page and layout routing in app directory.",
    "2. Extract interactive UI elements into leaf client components."
  ]
};
