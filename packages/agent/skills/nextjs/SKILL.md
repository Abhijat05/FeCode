---
name: nextjs
description: Next.js App Router, Pages Router, Server/Client components, routing, and data fetching.
category: framework
version: 2.1.0
---

## When to use

- building Next.js pages or components
- authoring Server/Client components
- Next.js routing and data fetching
- Next.js API routes

## Instructions

### Project Detection & Existing Rules
- **Inspect package.json**: Identify Next.js version (e.g. 13, 14, 15).
- **Determine Router**: Check if the project uses App Router (`app/`) or Pages Router (`pages/`). **Never assume**. Do not force App Router patterns onto a Pages Router project.
- **Follow existing patterns**: Follow existing routing, data fetching, and component conventions unless explicitly requested otherwise.

### Core Mental Model
- Server vs Client execution: Understand where code runs (Server Components, Client Components, SSR, SSG).
- Routing is filesystem-based.
- Layouts wrap pages and preserve state across navigations.
- Data fetching happens at the server when possible for performance.

### Server / Client Boundary (App Router)
- React Server Components are the default. They run only on the server, have access to backend resources, and send zero JS to the client.
- Client Components (`'use client'`) are needed for browser APIs, client state (`useState`), event handlers (`onClick`), and client-only hooks (`useEffect`).
- **Do not automatically add "use client"** everywhere. Keep Client Components as small as practical and push them down the tree to the leaf interactive elements.

### Routing
- **App Router**: Organise by folders (`app/dashboard/page.tsx`). Utilize `layout.tsx`, `loading.tsx`, `error.tsx`, and `not-found.tsx`.
- **Pages Router**: Organise by files (`pages/dashboard.tsx`). Utilize `_app.tsx`, `_document.tsx`.
- Respect dynamic segments and route structure conventions.

### Data
- Prefer server-side data loading.
- Use client-side fetching (e.g., SWR, React Query, or `useEffect`) only where appropriate.
- Manage loading and error states gracefully.
- Understand caching considerations (e.g. `fetch` cache options in App Router).
- Do not prescribe a single data library unless already established.

### Metadata / Assets
- Use the Next.js Metadata API for head tags and SEO (App Router) or `next/head` (Pages Router).
- Optimize images using `next/image`.
- Optimize fonts using `next/font`.
- Handle static assets correctly from the `public/` folder.

### Common Failure Modes
- **Unnecessary client boundaries**: Wrapping an entire page in `'use client'` instead of just the interactive leaf nodes.
- **Server/Client mismatch**: Hydration problems caused by rendering different content on the server vs client (e.g., using `window` directly in render).
- **Incorrect data-fetching assumptions**: Mixing Pages Router data fetching (`getServerSideProps`) in App Router components.
- **Caching surprises**: Next.js App Router aggressively caches `fetch`; beware of stale data.
- **Route structure mistakes**: Placing components in the `pages/` directory instead of standard directories, causing accidental route creation (Pages Router).

## Anti-Patterns

- **Using browser APIs in Server Components**
  - *What*: Calling `window.localStorage` inside a Server Component.
  - *Why*: Server Components run in Node.js/Edge, where `window` or `document` do not exist, causing crashes.
  - *Instead*: Move the logic requiring browser APIs to a Client Component or use a `useEffect` inside a Client Component.

## Workflow

### Debugging
- Check if an error happens on the Server or Client.
- Inspect network tabs for hydration errors.
- Verify Next.js caching headers and tags if data is stale.

### Verification
- Inspect the actual Next.js version.
- Typecheck the codebase (`tsc --noEmit`).
- Run project build and tests.
