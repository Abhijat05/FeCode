import * as fs from "fs/promises";
import * as path from "path";
import { parseSkillMarkdown } from "./parser.js";
import type { Skill } from "./types.js";
import { resolveSafePath } from "../tools/pathUtils.js";

export class SkillLoader {
  async loadSkillFromFile(filePath: string, rootDir?: string): Promise<Skill> {
    let targetPath = path.resolve(filePath);
    if (rootDir) {
      const res = resolveSafePath(rootDir, filePath);
      if ("error" in res) {
        const err = new Error(res.error.message);
        (err as { code?: string }).code = res.error.code;
        throw err;
      }
      targetPath = res.targetPath;
    }

    try {
      const content = await fs.readFile(targetPath, "utf-8");
      return parseSkillMarkdown(content);
    } catch (err: unknown) {
      if (err instanceof Error) {
        if ("code" in err && (err as { code: string }).code === "PATH_OUT_OF_BOUNDS") {
          throw err;
        }
        throw new Error(`Failed to load skill file '${path.basename(filePath)}': ${err.message}`);
      }
      throw new Error(`Failed to load skill file '${filePath}': ${String(err)}`);
    }
  }

  async loadSkillFromDir(dirPath: string, rootDir?: string): Promise<Skill> {
    const skillFilePath = path.join(dirPath, "SKILL.md");
    return this.loadSkillFromFile(skillFilePath, rootDir);
  }

  async discoverSkills(skillRootDir: string): Promise<Skill[]> {
    const root = path.resolve(skillRootDir);

    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read skill directory '${skillRootDir}': ${errorMsg}`);
    }

    const discoveredSkills: Skill[] = [];
    const seenNames = new Map<string, string>();

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const candidateFile = path.join(root, entry.name, "SKILL.md");
        try {
          const stat = await fs.stat(candidateFile);
          if (stat.isFile()) {
            const skill = await this.loadSkillFromFile(candidateFile, root);
            if (seenNames.has(skill.name)) {
              throw new Error(
                `Ambiguous duplicate skill '${skill.name}' discovered in '${candidateFile}' and '${seenNames.get(skill.name)}'.`
              );
            }
            seenNames.set(skill.name, candidateFile);
            discoveredSkills.push(skill);
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.message.includes("Ambiguous duplicate skill")) {
            throw err;
          }
          // Ignore subdirectories without SKILL.md
        }
      }
    }

    // Sort deterministically by skill name
    discoveredSkills.sort((a, b) => a.name.localeCompare(b.name));

    return discoveredSkills;
  }
}
