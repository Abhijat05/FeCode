import type { Skill, SkillRegistry } from "./types.js";
import type { ProjectContext } from "../project/types.js";

export interface SkillRecommendation {
  skill: Skill;
  score: number;
}

export interface RecommendSkillsOptions {
  request: string;
  registry: SkillRegistry;
  projectContext?: ProjectContext;
  maxResults?: number;
}

const MAX_DEFAULT = 3;

// ─── Normalisation ────────────────────────────────────────────────────────────

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim()
    .replace(/\bcomponents\b/g, "component")
    .replace(/\btests\b/g, "test");
}

function tokenize(text: string): Set<string> {
  return new Set(normalise(text).split(" ").filter((t) => t.length > 0));
}

// ─── Strong-signal keyword tables ─────────────────────────────────────────────

const KEYWORD_BOOST: Array<{ keywords: string[]; skillName: string; bonus: number }> = [
  // build/create/design/implement → frontend-design
  { keywords: ["build", "create", "design", "redesign", "implement", "make", "add", "write", "polished", "new", "settings", "dashboard"], skillName: "frontend-design", bonus: 15 },
  // review/audit/assess/evaluate → ui-review
  { keywords: ["review", "audit", "assess", "evaluate", "critique", "check"], skillName: "ui-review", bonus: 15 },
  // responsive/mobile/viewport/layout/breakpoint → responsive-design
  { keywords: ["responsive", "mobile", "viewport", "breakpoint", "narrow", "screen", "widths"], skillName: "responsive-design", bonus: 15 },
  // fix/debug/broken/error/bug/doesn't work/failing → frontend-debugging
  { keywords: ["fix", "debug", "broken", "breaks", "break", "error", "bug", "failing", "doesn", "work", "wrong", "crash", "throws", "throwing", "rendering", "render"], skillName: "frontend-debugging", bonus: 15 },
  // accessibility
  { keywords: ["accessible", "accessibility", "a11y", "aria", "reader"], skillName: "accessibility", bonus: 15 },
  // frontend-performance
  { keywords: ["slow", "performance", "optimize", "fast", "speed", "bottleneck"], skillName: "frontend-performance", bonus: 15 },
  // frontend-testing
  { keywords: ["test", "testing", "jest", "vitest", "coverage", "mock"], skillName: "frontend-testing", bonus: 15 }
];

const BACKEND_PENALTY_KEYWORDS = [
  "database",
  "postgres",
  "postgresql",
  "sql",
  "migration",
  "backend",
  "middleware",
  "worker",
  "server",
  "docker"
];

const FRONTEND_ACTION_VERBS = new Set(["build", "create", "implement", "make", "add", "write", "refactor", "update", "fix", "change", "new", "design", "style", "redesign"]);

function phraseWordMatchCount(phrase: string, requestTokens: Set<string>): number {
  const phraseTokens = tokenize(phrase);
  if (phraseTokens.size === 0) return 0;
  let matched = 0;
  for (const t of phraseTokens) {
    if (requestTokens.has(t)) matched++;
  }
  return matched;
}

function phraseScore(phrase: string, requestTokens: Set<string>): number {
  const phraseTokens = tokenize(phrase);
  const total = phraseTokens.size;
  if (total === 0) return 0;
  const matched = phraseWordMatchCount(phrase, requestTokens);
  if (matched === 0) return 0;
  return matched / total;
}

// ─── Scoring Constants ────────────────────────────────────────────────────────

const SCORE_EXACT_NAME = 10;
const SCORE_NAME_WORD = 4;
const SCORE_ACTIVATION_WHEN = 8;
const SCORE_DESCRIPTION = 2;
const SCORE_INSTRUCTION = 1;
const SCORE_NOT_WHEN_PENALTY = -10;
const SCORE_FRAMEWORK_MATCH = 4;

const FRAMEWORK_SKILL_MAP: Record<string, string[]> = {
  react: ["react"],
  next: ["react", "nextjs"],
  vue: ["vue"],
  nuxt: ["vue"],
  svelte: ["svelte"],
  sveltekit: ["svelte"]
};

// Skills in these categories are framework/tool specific
const FRAMEWORK_CATEGORIES = new Set(["framework", "styling"]);

function scoreSkill(
  skill: Skill,
  requestTokens: Set<string>,
  normalisedRequest: string,
  projectContext?: ProjectContext
): number {
  let score = 0;

  // Framework/styling skills require explicit request mention OR project context match
  const isFrameworkCategory = FRAMEWORK_CATEGORIES.has(skill.category);
  const nameTokens = tokenize(normalise(skill.name));
  const hasNameMention = [...nameTokens].some((t) => requestTokens.has(t));
  const isProjectFrameworkMatch =
    (projectContext?.framework &&
      (FRAMEWORK_SKILL_MAP[projectContext.framework] ?? []).includes(skill.name)) ||
    (projectContext?.styling && projectContext.styling.includes(skill.name));

  if (isFrameworkCategory && !hasNameMention && !isProjectFrameworkMatch) {
    return 0; // Exclude framework skills when neither context nor request references them
  }

  // ── Strong-signal keyword boost ────────────────────────────────────────────
  for (const entry of KEYWORD_BOOST) {
    if (entry.skillName === skill.name) {
      const matched = entry.keywords.some((kw) => requestTokens.has(kw));
      if (matched) score += entry.bonus;
    }
  }

  // ── Exact skill name match ──────────────────────────────────────────────────
  const allNameTokensPresent = nameTokens.size > 0 && [...nameTokens].every((t) => requestTokens.has(t));
  if (allNameTokensPresent) {
    score += SCORE_EXACT_NAME;
  } else {
    for (const t of nameTokens) {
      if (requestTokens.has(t)) {
        score += SCORE_NAME_WORD * (1 / nameTokens.size);
      }
    }
  }

  // ── Activation when phrases ─────────────────────────────────────────────────
  if (skill.activation?.when) {
    for (const phrase of skill.activation.when) {
      const ps = phraseScore(phrase, requestTokens);
      if (ps > 0) {
        score += SCORE_ACTIVATION_WHEN * ps;
      }
    }
  }

  // ── Activation notWhen penalty ──────────────────────────────────────────────
  if (skill.activation?.notWhen) {
    for (const phrase of skill.activation.notWhen) {
      const ps = phraseScore(phrase, requestTokens);
      if (ps > 0) {
        score += SCORE_NOT_WHEN_PENALTY * ps;
      }
    }
  }

  // ── Description word matches ────────────────────────────────────────────────
  const descTokens = tokenize(skill.description);
  for (const t of descTokens) {
    if (requestTokens.has(t) && t.length > 3) {
      score += SCORE_DESCRIPTION * (1 / descTokens.size);
    }
  }

  // ── Instruction word matches (low signal) ───────────────────────────────────
  for (const inst of skill.instructions) {
    const instTokens = tokenize(inst);
    for (const t of instTokens) {
      if (requestTokens.has(t) && t.length > 4) {
        score += SCORE_INSTRUCTION * (1 / instTokens.size);
        break;
      }
    }
  }

  // ── Project context framework boost ────────────────────────────────────────
  if (isProjectFrameworkMatch) {
    score += SCORE_FRAMEWORK_MATCH;
    // Boost framework skills if the request contains an active frontend verb
    if ([...requestTokens].some(t => FRONTEND_ACTION_VERBS.has(t))) {
      score += 2;
    }
  }

  // ── Backend keyword penalty ───────────────────────────────────────────────
  const hasBackendKeywords = BACKEND_PENALTY_KEYWORDS.some(kw => requestTokens.has(kw));
  if (hasBackendKeywords) {
    score -= 30; // Strong penalty for all frontend skills on backend tasks
  }

  return score;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function recommendSkillsFromRequest(options: RecommendSkillsOptions): SkillRecommendation[] {
  const { request, registry, projectContext, maxResults = MAX_DEFAULT } = options;
  const normRequest = normalise(request);
  const requestTokens = tokenize(request);

  const scored: SkillRecommendation[] = [];

  for (const skill of registry.list()) {
    const score = scoreSkill(skill, requestTokens, normRequest, projectContext);
    if (score > 0) {
      scored.push({ skill, score });
    }
  }

  // Sort: descending by score, then ascending by name for deterministic tie-breaking
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.skill.name.localeCompare(b.skill.name);
  });

  return scored.slice(0, maxResults);
}
