import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { findMcpConfigFile, loadMcpConfig } from "./config.js";

describe("findMcpConfigFile / loadMcpConfig", () => {
  let tmpDir: string;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-mcp-config-test-"));
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    consoleErrorSpy.mockRestore();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns {} when no .fecode/mcp.json exists anywhere up the tree", () => {
    expect(findMcpConfigFile(tmpDir)).toBeUndefined();
    expect(loadMcpConfig(tmpDir)).toEqual({});
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("finds and parses a valid .fecode/mcp.json in the given directory", async () => {
    const fecodeDir = path.join(tmpDir, ".fecode");
    await fs.mkdir(fecodeDir);
    const config = {
      mcpServers: {
        filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] },
        remote: { url: "https://example.com/mcp" }
      }
    };
    await fs.writeFile(path.join(fecodeDir, "mcp.json"), JSON.stringify(config));

    expect(findMcpConfigFile(tmpDir)).toBe(path.join(fecodeDir, "mcp.json"));
    expect(loadMcpConfig(tmpDir)).toEqual(config);
  });

  it("finds .fecode/mcp.json by walking up from a nested subdirectory", async () => {
    const fecodeDir = path.join(tmpDir, ".fecode");
    await fs.mkdir(fecodeDir);
    const config = { mcpServers: { foo: { command: "foo-server" } } };
    await fs.writeFile(path.join(fecodeDir, "mcp.json"), JSON.stringify(config));

    const nested = path.join(tmpDir, "a", "b", "c");
    await fs.mkdir(nested, { recursive: true });

    expect(loadMcpConfig(nested)).toEqual(config);
  });

  it("returns {} and logs a warning on malformed JSON, without throwing", async () => {
    const fecodeDir = path.join(tmpDir, ".fecode");
    await fs.mkdir(fecodeDir);
    await fs.writeFile(path.join(fecodeDir, "mcp.json"), "{ not valid json");

    expect(() => loadMcpConfig(tmpDir)).not.toThrow();
    expect(loadMcpConfig(tmpDir)).toEqual({});
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("returns {} and logs a warning when the file is valid JSON but not an object", async () => {
    const fecodeDir = path.join(tmpDir, ".fecode");
    await fs.mkdir(fecodeDir);
    await fs.writeFile(path.join(fecodeDir, "mcp.json"), JSON.stringify([1, 2, 3]));

    expect(loadMcpConfig(tmpDir)).toEqual({});
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
