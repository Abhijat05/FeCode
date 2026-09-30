import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import { killProcessTree } from "./processTree.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("killProcessTree", () => {
  it("safely handles undefined, null, or invalid process references without throwing", () => {
    expect(() => killProcessTree(undefined)).not.toThrow();
    expect(() => killProcessTree(null as unknown as undefined)).not.toThrow();
    expect(() => killProcessTree({} as unknown as undefined)).not.toThrow();
    expect(() => killProcessTree(-99999)).not.toThrow();
  });

  it("terminates a single running child process", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
      stdio: "ignore",
      windowsHide: true
    });

    expect(child.pid).toBeDefined();
    await delay(50);

    let exited = false;
    child.on("exit", () => {
      exited = true;
    });

    killProcessTree(child, "SIGTERM");

    // Allow time for termination
    const start = Date.now();
    while (!exited && Date.now() - start < 3000) {
      await delay(50);
    }

    expect(exited).toBe(true);
  });

  it("terminates a process tree with descendant child processes cleanly", async () => {
    // Parent spawns a grandchild that sleeps
    const script = `
      const { spawn } = require('child_process');
      const sub = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
        stdio: 'ignore',
        windowsHide: true
      });
      setTimeout(() => {}, 60000);
    `;

    const parent = spawn(process.execPath, ["-e", script], {
      stdio: "ignore",
      windowsHide: true
    });

    expect(parent.pid).toBeDefined();
    await delay(150);

    let parentExited = false;
    parent.on("exit", () => {
      parentExited = true;
    });

    killProcessTree(parent, "SIGTERM");

    const start = Date.now();
    while (!parentExited && Date.now() - start < 3000) {
      await delay(50);
    }

    expect(parentExited).toBe(true);
  });

  it("handles already-terminated processes gracefully without error", async () => {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
      stdio: "ignore",
      windowsHide: true
    });

    await delay(100);
    expect(() => killProcessTree(child)).not.toThrow();
    if (child.pid) {
      expect(() => killProcessTree(child.pid)).not.toThrow();
    }
  });
});
