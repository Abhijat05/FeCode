import { describe, it, expect } from "vitest";
import { classifyArea, classifyCategory } from "./classifier.js";

describe("Change Classifier — Phase 5E", () => {
  describe("classifyArea", () => {
    it("classifies component paths", () => {
      expect(classifyArea("src/components/LoginForm.tsx")).toBe("components");
      expect(classifyArea("components/Button.tsx")).toBe("components");
      expect(classifyArea("src/widgets/Sidebar.tsx")).toBe("components");
    });

    it("classifies pages and views", () => {
      expect(classifyArea("src/pages/DashboardPage.tsx")).toBe("pages");
      expect(classifyArea("pages/index.tsx")).toBe("pages");
      expect(classifyArea("src/views/Home.tsx")).toBe("pages");
    });

    it("classifies routes and app router", () => {
      expect(classifyArea("src/routes/users.ts")).toBe("routes");
      expect(classifyArea("routes/api.ts")).toBe("routes");
      expect(classifyArea("app/api/auth/route.ts")).toBe("routes");
      expect(classifyArea("src/app/layout.tsx")).toBe("routes");
    });

    it("classifies hooks", () => {
      expect(classifyArea("src/hooks/useAuth.ts")).toBe("hooks");
      expect(classifyArea("hooks/useLocalStorage.js")).toBe("hooks");
      expect(classifyArea("src/useTheme.ts")).toBe("hooks");
    });

    it("classifies utilities and libraries", () => {
      expect(classifyArea("src/utils/formatDate.ts")).toBe("utilities");
      expect(classifyArea("src/lib/apiClient.ts")).toBe("utilities");
      expect(classifyArea("src/helpers/string.ts")).toBe("utilities");
    });

    it("classifies authentication paths", () => {
      expect(classifyArea("src/auth/session.ts")).toBe("authentication");
      expect(classifyArea("auth/token.ts")).toBe("authentication");
      expect(classifyArea("src/utils/auth.ts")).toBe("authentication");
      expect(classifyArea("auth.ts")).toBe("authentication");
    });

    it("classifies tests", () => {
      expect(classifyArea("tests/unit.test.ts")).toBe("tests");
      expect(classifyArea("src/components/Button.test.tsx")).toBe("tests");
      expect(classifyArea("src/__tests__/app.spec.ts")).toBe("tests");
    });

    it("classifies styles", () => {
      expect(classifyArea("src/styles/global.css")).toBe("styles");
      expect(classifyArea("styles/theme.scss")).toBe("styles");
      expect(classifyArea("src/App.css")).toBe("styles");
    });

    it("classifies services and state", () => {
      expect(classifyArea("src/services/userService.ts")).toBe("services");
      expect(classifyArea("src/context/AuthContext.tsx")).toBe("state");
      expect(classifyArea("src/store/counterSlice.ts")).toBe("state");
    });

    it("falls back to other for unclassified paths", () => {
      expect(classifyArea("assets/logo.png")).toBe("other");
      expect(classifyArea("random.dat")).toBe("other");
    });
  });

  describe("classifyCategory", () => {
    it("classifies tests", () => {
      expect(classifyCategory("src/Button.test.tsx")).toBe("tests");
      expect(classifyCategory("tests/e2e.spec.ts")).toBe("tests");
    });

    it("classifies styling", () => {
      expect(classifyCategory("src/index.css")).toBe("styling");
      expect(classifyCategory("tailwind.config.ts")).toBe("styling");
      expect(classifyCategory("postcss.config.js")).toBe("styling");
    });

    it("classifies configuration", () => {
      expect(classifyCategory("package.json")).toBe("configuration");
      expect(classifyCategory("tsconfig.json")).toBe("configuration");
      expect(classifyCategory("vite.config.ts")).toBe("configuration");
      expect(classifyCategory(".eslintrc.json")).toBe("configuration");
      expect(classifyCategory("vitest.config.ts")).toBe("configuration");
    });

    it("classifies documentation", () => {
      expect(classifyCategory("README.md")).toBe("documentation");
      expect(classifyCategory("docs/architecture.md")).toBe("documentation");
      expect(classifyCategory("LICENSE")).toBe("documentation");
    });

    it("classifies tooling", () => {
      expect(classifyCategory("scripts/deploy.sh")).toBe("tooling");
      expect(classifyCategory(".github/workflows/ci.yml")).toBe("tooling");
      expect(classifyCategory(".vscode/settings.json")).toBe("tooling");
    });

    it("classifies frontend", () => {
      expect(classifyCategory("src/components/Header.tsx")).toBe("frontend");
      expect(classifyCategory("src/App.jsx")).toBe("frontend");
      expect(classifyCategory("index.html")).toBe("frontend");
    });

    it("classifies backend", () => {
      expect(classifyCategory("server.ts")).toBe("backend");
      expect(classifyCategory("src/server/db.ts")).toBe("backend");
      expect(classifyCategory("backend/app.js")).toBe("backend");
    });

    it("falls back to other for unclassified paths", () => {
      expect(classifyCategory("data.bin")).toBe("other");
    });
  });
});
