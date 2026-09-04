import type {
  Skill,
  SkillCategory,
  SkillExample,
  SkillReference
} from "./types.js";

const VALID_CATEGORIES = new Set<SkillCategory>([
  "frontend",
  "framework",
  "styling",
  "testing",
  "accessibility",
  "architecture"
]);

interface FrontmatterData {
  name?: string;
  description?: string;
  category?: string;
  version?: string;
}

export function parseFrontmatter(content: string): {
  frontmatter: FrontmatterData;
  body: string;
} {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    throw new Error("Invalid SKILL.md: Frontmatter starting delimiter '---' not found.");
  }

  const match = trimmed.slice(3).match(/\r?\n---\r?\n?/);
  if (!match || match.index === undefined) {
    throw new Error("Invalid SKILL.md: Frontmatter ending delimiter '---' not found.");
  }

  const endMatchIndex = match.index + 3;
  const yamlBlock = trimmed.slice(3, endMatchIndex).trim();
  const body = trimmed.slice(endMatchIndex + match[0].length).trim();

  const frontmatter: FrontmatterData = {};
  const lines = yamlBlock.split(/\r?\n/);

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let value = line.slice(colonIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key === "name") frontmatter.name = value;
      else if (key === "description") frontmatter.description = value;
      else if (key === "category") frontmatter.category = value;
      else if (key === "version") frontmatter.version = value;
    }
  }

  return { frontmatter, body };
}

function parseBulletList(content: string): string[] {
  const items: string[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      items.push(trimmed.slice(2).trim());
    } else if (/^\d+\.\s/.test(trimmed)) {
      items.push(trimmed);
    } else if (trimmed.length > 0 && !trimmed.startsWith("#")) {
      items.push(trimmed);
    }
  }

  return items;
}

function parseExamplesSection(content: string): SkillExample[] {
  const examples: SkillExample[] = [];
  const parts = content.split(/^###\s+/m);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const firstLineEnd = trimmed.indexOf("\n");
    if (firstLineEnd === -1) {
      examples.push({ title: trimmed, example: "" });
    } else {
      const title = trimmed.slice(0, firstLineEnd).trim();
      const exampleText = trimmed.slice(firstLineEnd + 1).trim();
      examples.push({ title, example: exampleText });
    }
  }

  return examples;
}

function parseReferencesSection(content: string): SkillReference[] {
  const references: SkillReference[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Pattern: - Name: path (description) OR - Name: path
    const cleanLine = trimmed.replace(/^[-*]\s*/, "");
    const colonIdx = cleanLine.indexOf(":");
    if (colonIdx > 0) {
      const name = cleanLine.slice(0, colonIdx).trim();
      let rest = cleanLine.slice(colonIdx + 1).trim();
      let description: string | undefined;

      const parenMatch = rest.match(/^(.*?)\s*\((.*?)\)$/);
      if (parenMatch) {
        rest = parenMatch[1].trim();
        description = parenMatch[2].trim();
      }

      references.push({ name, path: rest, description });
    }
  }

  return references;
}

export function parseSkillMarkdown(markdownContent: string): Skill {
  const { frontmatter, body } = parseFrontmatter(markdownContent);

  if (!frontmatter.name) throw new Error("Frontmatter field 'name' is required.");
  if (!frontmatter.description) throw new Error("Frontmatter field 'description' is required.");
  if (!frontmatter.category) throw new Error("Frontmatter field 'category' is required.");
  if (!frontmatter.version) throw new Error("Frontmatter field 'version' is required.");

  const category = frontmatter.category as SkillCategory;
  if (!VALID_CATEGORIES.has(category)) {
    throw new Error(`Invalid category '${frontmatter.category}'. Must be one of: ${Array.from(VALID_CATEGORIES).join(", ")}`);
  }

  const whenList: string[] = [];
  const notWhenList: string[] = [];
  let instructions: string[] = [];
  let workflow: string[] = [];
  let rules: string[] = [];
  let antiPatterns: string[] = [];
  let examples: SkillExample[] = [];
  let references: SkillReference[] = [];

  // Heading alias map: normalises expressive SKILL.md headings to canonical field names.
  // Allows natural heading names like "Design Workflow" or "Self-Review Checklist" in authored skills.
  const HEADING_ALIASES: Record<string, string> = {
    // workflow aliases
    "workflow": "workflow",
    "design workflow": "workflow",
    "implementation workflow": "workflow",
    "debugging workflow": "workflow",
    "review workflow": "workflow",
    "process": "workflow",
    "design process": "workflow",
    "debugging process": "workflow",
    // rules aliases
    "rules": "rules",
    "self-review checklist": "rules",
    "self review checklist": "rules",
    "review checklist": "rules",
    "checklist": "rules",
    "quality checklist": "rules",
    "self-check before producing findings": "rules",
    // antiPatterns aliases
    "avoid": "antiPatterns",
    "avoiding generic ai-generated ui": "antiPatterns",
    "avoiding generic ui": "antiPatterns",
    "anti-patterns": "antiPatterns",
    "antipatterns": "antiPatterns",
    "common mistakes": "antiPatterns",
    "visual quality / ai-slop avoidance": "antiPatterns"
  };

  const sectionBlocks = body.split(/^##\s+/m);

  for (const block of sectionBlocks) {
    const trimmedBlock = block.trim();
    if (!trimmedBlock) continue;

    const firstLineEnd = trimmedBlock.indexOf("\n");
    const heading = (firstLineEnd === -1 ? trimmedBlock : trimmedBlock.slice(0, firstLineEnd)).trim().toLowerCase();
    const sectionContent = firstLineEnd === -1 ? "" : trimmedBlock.slice(firstLineEnd + 1).trim();
    const canonical = HEADING_ALIASES[heading] ?? heading;

    if (heading === "when to use") {
      whenList.push(...parseBulletList(sectionContent));
    } else if (heading === "when not to use") {
      notWhenList.push(...parseBulletList(sectionContent));
    } else if (heading === "instructions") {
      instructions = parseBulletList(sectionContent);
    } else if (canonical === "workflow") {
      workflow = parseBulletList(sectionContent);
    } else if (canonical === "rules") {
      rules = parseBulletList(sectionContent);
    } else if (canonical === "antiPatterns") {
      antiPatterns = parseBulletList(sectionContent);
    } else if (heading === "examples") {
      examples = parseExamplesSection(sectionContent);
    } else if (heading === "references") {
      references = parseReferencesSection(sectionContent);
    }
    // Unknown headings are silently ignored — they do not corrupt known fields.
  }

  if (instructions.length === 0) {
    instructions = [frontmatter.description];
  }

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    category,
    version: frontmatter.version,
    activation:
      whenList.length > 0 || notWhenList.length > 0
        ? {
            when: whenList,
            notWhen: notWhenList.length > 0 ? notWhenList : undefined
          }
        : undefined,
    instructions,
    workflow: workflow.length > 0 ? workflow : undefined,
    rules: rules.length > 0 ? rules : undefined,
    antiPatterns: antiPatterns.length > 0 ? antiPatterns : undefined,
    examples: examples.length > 0 ? examples : undefined,
    references: references.length > 0 ? references : undefined
  };
}
