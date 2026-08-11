import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

export interface TestFixture {
  dirPath: string;
  cleanup(): Promise<void>;
}

export async function createFrontendTestFixture(): Promise<TestFixture> {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "fecode-fixture-proj-")
  );

  await fs.writeFile(
    path.join(tmpDir, "package.json"),
    JSON.stringify(
      {
        name: "fixture-frontend-project",
        version: "1.0.0",
        dependencies: {
          react: "^18.3.1"
        }
      },
      null,
      2
    )
  );

  const srcDir = path.join(tmpDir, "src");
  const componentsDir = path.join(srcDir, "components");
  const pagesDir = path.join(srcDir, "pages");

  await fs.mkdir(srcDir, { recursive: true });
  await fs.mkdir(componentsDir, { recursive: true });
  await fs.mkdir(pagesDir, { recursive: true });

  await fs.writeFile(
    path.join(srcDir, "App.tsx"),
    `import React from "react";
import { DashboardPage } from "./pages/DashboardPage.js";

export function App() {
  return <DashboardPage />;
}
`
  );

  await fs.writeFile(
    path.join(componentsDir, "DashboardHeader.tsx"),
    `import React from "react";

export function DashboardHeader() {
  return <header><h1>Dashboard Overview</h1></header>;
}
`
  );

  await fs.writeFile(
    path.join(componentsDir, "Dashboard.tsx"),
    `import React from "react";
import { DashboardHeader } from "./DashboardHeader.js";

export function Dashboard() {
  return (
    <main>
      <DashboardHeader />
      <section>Dashboard Main Content</section>
    </main>
  );
}
`
  );

  await fs.writeFile(
    path.join(pagesDir, "DashboardPage.tsx"),
    `import React from "react";
import { Dashboard } from "../components/Dashboard.js";

export function DashboardPage() {
  return (
    <div className="dashboard-page">
      <Dashboard />
    </div>
  );
}
`
  );

  return {
    dirPath: tmpDir,
    async cleanup() {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  };
}
