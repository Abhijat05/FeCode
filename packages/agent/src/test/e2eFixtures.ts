import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

export interface E2EFixture {
  dirPath: string;
  cleanup(): Promise<void>;
}

export async function createReactTsFixture(): Promise<E2EFixture> {
  const dirPath = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-e2e-react-ts-"));

  await fs.writeFile(
    path.join(dirPath, "package.json"),
    JSON.stringify(
      {
        name: "e2e-react-ts",
        version: "1.0.0",
        type: "module",
        scripts: {
          test: "vitest run",
          typecheck: "tsc --noEmit"
        },
        dependencies: {
          react: "^18.3.1",
          "react-dom": "^18.3.1"
        },
        devDependencies: {
          typescript: "^5.4.5",
          vitest: "^1.6.0"
        }
      },
      null,
      2
    )
  );

  await fs.writeFile(
    path.join(dirPath, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          jsx: "react-jsx",
          strict: true
        }
      },
      null,
      2
    )
  );

  const srcDir = path.join(dirPath, "src");
  const compDir = path.join(srcDir, "components");
  const pagesDir = path.join(srcDir, "pages");
  const utilsDir = path.join(srcDir, "utils");
  const testsDir = path.join(dirPath, "tests");

  await fs.mkdir(compDir, { recursive: true });
  await fs.mkdir(pagesDir, { recursive: true });
  await fs.mkdir(utilsDir, { recursive: true });
  await fs.mkdir(testsDir, { recursive: true });

  await fs.writeFile(
    path.join(compDir, "LoginButton.tsx"),
    `import React from "react";

export interface LoginButtonProps {
  onClick?: () => void;
  loading?: boolean;
}

export const LoginButton: React.FC<LoginButtonProps> = ({ onClick, loading }) => {
  return (
    <button onClick={onClick} disabled={loading} className="btn-login">
      {loading ? "Loading..." : "Login"}
    </button>
  );
};
`
  );

  await fs.writeFile(
    path.join(compDir, "LoginForm.tsx"),
    `import React, { useState } from "react";
import { LoginButton } from "./LoginButton.js";

export const LoginForm: React.FC = () => {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
  };

  return (
    <form onSubmit={handleSubmit} className="login-form">
      <input
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
      />
      <LoginButton loading={loading} />
    </form>
  );
};
`
  );

  await fs.writeFile(
    path.join(pagesDir, "DashboardPage.tsx"),
    `import React from "react";

export const DashboardPage: React.FC = () => {
  return (
    <div className="dashboard-container">
      <header>
        <h1>Dashboard Overview</h1>
      </header>
      <main>
        <p>Welcome to your analytics dashboard</p>
      </main>
    </div>
  );
};
`
  );

  await fs.writeFile(
    path.join(utilsDir, "auth.ts"),
    `// Authentication and authorization utilities
export function authenticate(token: string): boolean {
  return Boolean(token && token.length > 5);
}

export function getAuthHeader(token: string): Record<string, string> {
  return {
    Authorization: \`Bearer \${token}\`
  };
}
`
  );

  await fs.writeFile(
    path.join(testsDir, "auth.test.ts"),
    `import { describe, it, expect } from "vitest";
import { authenticate } from "../src/utils/auth.js";

describe("authenticate", () => {
  it("returns true for valid token", () => {
    expect(authenticate("secure-token-123")).toBe(true);
  });

  it("returns false for short token", () => {
    expect(authenticate("abc")).toBe(false);
  });
});
`
  );

  return {
    dirPath,
    async cleanup() {
      await fs.rm(dirPath, { recursive: true, force: true });
    }
  };
}

export async function createReactTailwindFixture(): Promise<E2EFixture> {
  const dirPath = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-e2e-tailwind-"));

  await fs.writeFile(
    path.join(dirPath, "package.json"),
    JSON.stringify(
      {
        name: "e2e-tailwind-app",
        version: "1.0.0",
        dependencies: {
          react: "^18.3.1",
          tailwindcss: "^3.4.1"
        }
      },
      null,
      2
    )
  );

  await fs.writeFile(
    path.join(dirPath, "tailwind.config.js"),
    `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: { extend: {} },
  plugins: [],
};
`
  );

  const compDir = path.join(dirPath, "src", "components");
  await fs.mkdir(compDir, { recursive: true });

  await fs.writeFile(
    path.join(compDir, "SettingsModal.tsx"),
    `import React from "react";

export const SettingsModal: React.FC = () => {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h2 className="text-xl font-bold text-gray-900">User Settings</h2>
        <div className="mt-4 flex justify-end gap-2">
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
`
  );

  return {
    dirPath,
    async cleanup() {
      await fs.rm(dirPath, { recursive: true, force: true });
    }
  };
}

export async function createNextJsFixture(): Promise<E2EFixture> {
  const dirPath = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-e2e-next-"));

  await fs.writeFile(
    path.join(dirPath, "package.json"),
    JSON.stringify(
      {
        name: "e2e-nextjs-app",
        version: "1.0.0",
        dependencies: {
          next: "14.2.3",
          react: "^18.3.1"
        }
      },
      null,
      2
    )
  );

  await fs.writeFile(
    path.join(dirPath, "next.config.js"),
    `/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true };
module.exports = nextConfig;
`
  );

  const appDir = path.join(dirPath, "src", "app");
  await fs.mkdir(appDir, { recursive: true });

  await fs.writeFile(
    path.join(appDir, "page.tsx"),
    `export default function HomePage() {
  return (
    <main>
      <h1>Next.js Home Page</h1>
    </main>
  );
}
`
  );

  return {
    dirPath,
    async cleanup() {
      await fs.rm(dirPath, { recursive: true, force: true });
    }
  };
}

export async function createVueFixture(): Promise<E2EFixture> {
  const dirPath = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-e2e-vue-"));

  await fs.writeFile(
    path.join(dirPath, "package.json"),
    JSON.stringify(
      {
        name: "e2e-vue-app",
        version: "1.0.0",
        dependencies: {
          vue: "^3.4.27"
        }
      },
      null,
      2
    )
  );

  const srcDir = path.join(dirPath, "src");
  await fs.mkdir(srcDir, { recursive: true });

  await fs.writeFile(
    path.join(srcDir, "App.vue"),
    `<template>
  <div id="app">
    <h1>{{ title }}</h1>
  </div>
</template>

<script>
export default {
  data() {
    return {
      title: "Vue Application"
    };
  }
};
</script>
`
  );

  return {
    dirPath,
    async cleanup() {
      await fs.rm(dirPath, { recursive: true, force: true });
    }
  };
}

export async function createPackageManagerFixture(
  pm: "npm" | "pnpm" | "yarn" | "bun"
): Promise<E2EFixture> {
  const dirPath = await fs.mkdtemp(path.join(os.tmpdir(), `fecode-e2e-pm-${pm}-`));

  const versions: Record<string, string> = {
    npm: "npm@10.5.0",
    pnpm: "pnpm@9.1.0",
    yarn: "yarn@4.1.0",
    bun: "bun@1.1.0"
  };

  await fs.writeFile(
    path.join(dirPath, "package.json"),
    JSON.stringify(
      {
        name: `e2e-${pm}-project`,
        version: "1.0.0",
        packageManager: versions[pm],
        scripts: {
          test: `${pm} run test:unit`
        }
      },
      null,
      2
    )
  );

  return {
    dirPath,
    async cleanup() {
      await fs.rm(dirPath, { recursive: true, force: true });
    }
  };
}
