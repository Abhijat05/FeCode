import type { Skill } from "../types.js";

export const nextjsSkill: Skill = {
  name: "nextjs",
  description: "Next.js App Router, Server/Client component separation, routing, and data fetching.",
  category: "framework",
  version: "1.0.0",
  instructions: `### Skill: Next.js Best Practices
- Distinguish between React Server Components (default in App Router) and Client Components ('use client').
- Keep 'use client' directives as close to the leaf interactive components as possible.
- Use Next.js metadata API for head tags and SEO management.
- Follow Next.js directory routing conventions (app/page.tsx, layout.tsx, loading.tsx, error.tsx).`
};
