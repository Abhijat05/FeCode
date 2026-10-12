import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  isBinaryPath,
  hasBinaryMagicBytes,
  isBinaryBuffer,
  isBinaryFile
} from "./binaryUtils.js";

describe("binaryUtils", () => {
  describe("isBinaryPath", () => {
    it("identifies common binary extensions", () => {
      expect(isBinaryPath("app.exe")).toBe(true);
      expect(isBinaryPath("lib.dll")).toBe(true);
      expect(isBinaryPath("lib.so")).toBe(true);
      expect(isBinaryPath("module.wasm")).toBe(true);
      expect(isBinaryPath("image.png")).toBe(true);
      expect(isBinaryPath("photo.jpeg")).toBe(true);
      expect(isBinaryPath("doc.pdf")).toBe(true);
      expect(isBinaryPath("archive.zip")).toBe(true);
      expect(isBinaryPath("database.sqlite")).toBe(true);
      expect(isBinaryPath("database.sqlite3")).toBe(true);
      expect(isBinaryPath("font.woff2")).toBe(true);
    });

    it("identifies text / source code extensions as non-binary", () => {
      expect(isBinaryPath("index.ts")).toBe(false);
      expect(isBinaryPath("script.js")).toBe(false);
      expect(isBinaryPath("main.py")).toBe(false);
      expect(isBinaryPath("README.md")).toBe(false);
      expect(isBinaryPath("package.json")).toBe(false);
      expect(isBinaryPath("config.yaml")).toBe(false);
      expect(isBinaryPath("Makefile")).toBe(false);
    });
  });

  describe("hasBinaryMagicBytes", () => {
    it("detects ELF binaries", () => {
      const buf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]);
      expect(hasBinaryMagicBytes(buf)).toBe(true);
    });

    it("detects Windows PE / DOS binaries", () => {
      const buf = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ
      expect(hasBinaryMagicBytes(buf)).toBe(true);
    });

    it("detects PDF documents", () => {
      const buf = Buffer.from("%PDF-1.7\n%some binary\n");
      expect(hasBinaryMagicBytes(buf)).toBe(true);
    });

    it("detects ZIP archives", () => {
      const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
      expect(hasBinaryMagicBytes(buf)).toBe(true);
    });

    it("detects WASM binaries", () => {
      const buf = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00]);
      expect(hasBinaryMagicBytes(buf)).toBe(true);
    });

    it("detects SQLite databases", () => {
      const buf = Buffer.from("SQLite format 3\0");
      expect(hasBinaryMagicBytes(buf)).toBe(true);
    });

    it("detects PNG images", () => {
      const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(hasBinaryMagicBytes(buf)).toBe(true);
    });

    it("returns false for standard text files", () => {
      const buf = Buffer.from("import * as fs from 'fs';\nconsole.log('hello');\n");
      expect(hasBinaryMagicBytes(buf)).toBe(false);
    });
  });

  describe("isBinaryBuffer", () => {
    it("detects null bytes anywhere in buffer", () => {
      const buf = Buffer.concat([Buffer.from("Hello world"), Buffer.from([0x00])]);
      expect(isBinaryBuffer(buf)).toBe(true);
    });

    it("detects high density of non-whitespace control characters", () => {
      // Create buffer with > 10% non-whitespace control characters (e.g. 0x01, 0x02, 0x07)
      const text = Buffer.from("Hello world! ");
      const controls = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
      const buf = Buffer.concat([text, controls]);
      expect(isBinaryBuffer(buf)).toBe(true);
    });

    it("identifies clean text with newlines and tabs as non-binary", () => {
      const buf = Buffer.from("function test() {\n\tconst x = 10;\r\n\treturn x * 2;\n}\n");
      expect(isBinaryBuffer(buf)).toBe(false);
    });

    it("handles empty buffers as non-binary", () => {
      expect(isBinaryBuffer(Buffer.alloc(0))).toBe(false);
    });
  });

  describe("isBinaryFile", () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fecode-bin-test-"));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it("identifies polyglot files with 1.5KB ASCII header followed by binary bytes", async () => {
      const polyglotPath = path.join(tmpDir, "polyglot.dat");
      const asciiPreamble = Buffer.alloc(1500, 0x41); // 'A's
      const binaryPayload = Buffer.from([0x00, 0xff, 0xfe, 0x01]);
      await fs.writeFile(polyglotPath, Buffer.concat([asciiPreamble, binaryPayload]));

      const isBin = await isBinaryFile(polyglotPath);
      expect(isBin).toBe(true);
    });

    it("identifies text files as non-binary", async () => {
      const textPath = path.join(tmpDir, "source.ts");
      await fs.writeFile(textPath, "export const x = 42;\n");

      const isBin = await isBinaryFile(textPath);
      expect(isBin).toBe(false);
    });
  });
});
