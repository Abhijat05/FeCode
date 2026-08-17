import * as path from "path";

/**
 * Normalizes a file path to forward slashes and lowercases for classification.
 */
function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").toLowerCase();
}

/**
 * Classifies a project area based on file path conventions.
 */
export function classifyArea(filePath: string): string {
  const norm = normalizePath(filePath);
  const baseName = path.basename(filePath); // preserve casing for hook check

  // Tests
  if (
    norm.includes("/tests/") ||
    norm.startsWith("tests/") ||
    norm.includes("/__tests__/") ||
    norm.includes(".test.") ||
    norm.includes(".spec.")
  ) {
    return "tests";
  }

  // Components
  if (
    norm.includes("/components/") ||
    norm.startsWith("components/") ||
    norm.includes("/widgets/")
  ) {
    return "components";
  }

  // Pages
  if (
    norm.includes("/pages/") ||
    norm.startsWith("pages/") ||
    norm.includes("/views/")
  ) {
    return "pages";
  }

  // Routes / App router
  if (
    norm.includes("/routes/") ||
    norm.startsWith("routes/") ||
    norm.includes("/app/") ||
    norm.startsWith("app/")
  ) {
    return "routes";
  }

  // Hooks (e.g. useAuth.ts, useTheme.ts, or in hooks/ dir)
  if (
    norm.includes("/hooks/") ||
    norm.startsWith("hooks/") ||
    /^use[A-Z0-9_]/.test(baseName)
  ) {
    return "hooks";
  }

  // Authentication
  if (
    norm.includes("/auth/") ||
    norm.startsWith("auth/") ||
    norm.endsWith("/auth.ts") ||
    norm.endsWith("/auth.js") ||
    norm.endsWith("/auth.tsx") ||
    norm.endsWith("/auth.jsx") ||
    norm === "auth.ts" ||
    norm === "auth.js"
  ) {
    return "authentication";
  }

  // Utilities / Lib
  if (
    norm.includes("/utils/") ||
    norm.startsWith("utils/") ||
    norm.includes("/lib/") ||
    norm.startsWith("lib/") ||
    norm.includes("/helpers/")
  ) {
    return "utilities";
  }

  // Styles
  if (
    norm.includes("/styles/") ||
    norm.startsWith("styles/") ||
    norm.endsWith(".css") ||
    norm.endsWith(".scss") ||
    norm.endsWith(".sass") ||
    norm.endsWith(".less")
  ) {
    return "styles";
  }

  // Services / API
  if (
    norm.includes("/services/") ||
    norm.startsWith("services/") ||
    norm.includes("/api/") ||
    norm.startsWith("api/")
  ) {
    return "services";
  }

  // State / Context / Store
  if (
    norm.includes("/context/") ||
    norm.startsWith("context/") ||
    norm.includes("/state/") ||
    norm.startsWith("state/") ||
    norm.includes("/store/") ||
    norm.startsWith("store/")
  ) {
    return "state";
  }

  return "other";
}

/**
 * Classifies a change category based on file extension and path.
 */
export function classifyCategory(filePath: string): string {
  const norm = normalizePath(filePath);
  const base = path.basename(norm);

  // Tests
  if (
    norm.includes("/tests/") ||
    norm.startsWith("tests/") ||
    norm.includes("/__tests__/") ||
    norm.includes(".test.") ||
    norm.includes(".spec.")
  ) {
    return "tests";
  }

  // Styling
  if (
    norm.endsWith(".css") ||
    norm.endsWith(".scss") ||
    norm.endsWith(".sass") ||
    norm.endsWith(".less") ||
    base.startsWith("tailwind.config") ||
    base.startsWith("postcss.config")
  ) {
    return "styling";
  }

  // Configuration
  if (
    base === "package.json" ||
    base === "package-lock.json" ||
    base.startsWith("tsconfig") ||
    base.startsWith("vite.config") ||
    base.startsWith("next.config") ||
    base.startsWith("webpack.config") ||
    base.startsWith("vitest.config") ||
    base.startsWith("jest.config") ||
    base.startsWith(".eslintrc") ||
    base.startsWith("eslint.config") ||
    base.startsWith(".prettier") ||
    base.startsWith(".babel")
  ) {
    return "configuration";
  }

  // Documentation
  if (
    norm.endsWith(".md") ||
    norm.endsWith(".mdx") ||
    norm.includes("/docs/") ||
    norm.startsWith("docs/") ||
    base.startsWith("readme") ||
    base.startsWith("license") ||
    base.startsWith("changelog")
  ) {
    return "documentation";
  }

  // Tooling
  if (
    norm.includes("/scripts/") ||
    norm.startsWith("scripts/") ||
    norm.includes("/.github/") ||
    norm.startsWith(".github/") ||
    norm.includes("/.vscode/") ||
    norm.startsWith(".vscode/")
  ) {
    return "tooling";
  }

  // Frontend
  if (
    norm.endsWith(".tsx") ||
    norm.endsWith(".jsx") ||
    norm.endsWith(".vue") ||
    norm.endsWith(".svelte") ||
    norm.endsWith(".html") ||
    norm.includes("/components/") ||
    norm.includes("/pages/") ||
    norm.includes("/hooks/")
  ) {
    return "frontend";
  }

  // Backend
  if (
    norm.includes("/server/") ||
    norm.startsWith("server/") ||
    norm.includes("/backend/") ||
    norm.startsWith("backend/") ||
    base === "server.ts" ||
    base === "server.js"
  ) {
    return "backend";
  }

  return "other";
}
