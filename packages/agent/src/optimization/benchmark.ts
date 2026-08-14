import { DefaultTokenOptimizer } from "./defaultOptimizer.js";
import { PonytailTokenOptimizer } from "./providers/ponytail/ponytailOptimizer.js";
import { estimateTokens } from "./estimator.js";
import type { TokenOptimizer } from "./types.js";

export interface BenchmarkReportItem {
  fixture: "Small" | "Medium" | "Large" | "Maximum";
  optimizer: "Default" | "Ponytail";
  inputTokens: number;
  outputTokens: number;
  tokensSaved: number;
  reductionRatio: number;
  durationMs: number;
  protectedContentValid: boolean;
}

export function createBenchmarkFixtures(): Record<"Small" | "Medium" | "Large" | "Maximum", string> {
  const smallSkill = `## Active FeCode Skills

### Skill: react
React UI component development rules and hooks lifecycle.

#### Rules
- Always clean up effects
- Never mutate state directly
- Keep component pure with respect to props

#### Workflow
- 1. Identify state ownership
- 2. Implement hooks
- 3. Derive state when possible

#### Anti-Patterns
- Index as key in dynamic lists
- Direct DOM mutations

#### Instructions
- Prefer hooks over class components
- Keep side-effects isolated

#### Examples

**Counter Example**
\`\`\`tsx
function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
\`\`\``;

  const mediumSkills = `${smallSkill}

---

### Skill: frontend-design
Frontend design and component aesthetics.

#### Rules
- Never use unconstrained massive typography
- Keep consistent spacing scales

#### Workflow
- 1. Define layout constraints
- 2. Add visual hierarchy

#### Anti-Patterns
- Bento boxes stuffed with unrelated icons
- Low contrast text on tinted backgrounds

#### Instructions
- Prioritize content readability
- Maintain accessible contrast

#### Examples

**Card Component**
\`\`\`tsx
function Card({ title, children }: { title: string; children: ReactNode }) {
  return <div className="p-4 border rounded shadow-sm"><h3>{title}</h3>{children}</div>;
}
\`\`\`

---

### Skill: accessibility
WCAG and accessible web UI patterns.

#### Rules
- Ensure keyboard focus is visible
- Provide accessible labels for icon buttons

#### Workflow
- 1. Check keyboard navigation
- 2. Verify ARIA landmarks

#### Anti-Patterns
- Clickable div without role=button
- Missing alt on informative images

#### Instructions
- Use semantic HTML landmarks
- Test screen-reader announcements`;

  const largeSkills = `${mediumSkills}

---

### Skill: frontend-performance
Frontend runtime and rendering performance optimizations.

#### Rules
- Do not memoize prematurely
- Keep bundle size constrained

#### Workflow
- 1. Measure baseline metrics (LCP, INP, CLS)
- 2. Profile render bottlenecks
- 3. Apply targeted optimizations

#### Anti-Patterns
- Inline arrow functions in hot render loops without need
- Unoptimized full-resolution hero images

#### Instructions
- Profile before optimizing
- Use dynamic imports for heavy modal components

#### Examples

**Lazy Loading Example**
\`\`\`tsx
const HeavyChart = React.lazy(() => import('./HeavyChart'));
function Dashboard() {
  return (
    <Suspense fallback={<Spinner />}>
      <HeavyChart />
    </Suspense>
  );
}
\`\`\`

**Another Performance Example**
\`\`\`tsx
function MemoizedList({ items }: { items: string[] }) {
  return <ul>{items.map(it => <li key={it}>{it}</li>)}</ul>;
}
\`\`\``;

  // Maximum fixture: deliberately oversized (~8000+ tokens) to exceed the 6000 token budget
  const extraSkills: string[] = [];
  for (let i = 1; i <= 40; i++) {
    extraSkills.push(`### Skill: extra-skill-${i}
Skill ${i} comprehensive frontend and architecture guidelines.

#### Rules
- Rule ${i}.1: Enforce strict contract boundaries
- Rule ${i}.2: Verify component accessibility

#### Workflow
- 1. Initialize step ${i}
- 2. Validate step ${i}

#### Anti-Patterns
- AntiPattern ${i}: Do not ignore edge conditions

#### Instructions
- Follow architecture pattern ${i}
- Document domain constraints for module ${i}

#### Examples

**Example A for Skill ${i}**
\`\`\`tsx
export function Component${i}A() {
  return <div>Component ${i} Sample Implementation with extra long description</div>;
}
\`\`\`

**Example B for Skill ${i}**
\`\`\`tsx
export function Component${i}B() {
  return <div>Second example block for extra skill ${i} demonstrating detailed state handling</div>;
}
\`\`\``);
  }

  const maximumSkills = `${largeSkills}\n\n---\n\n${extraSkills.join("\n\n---\n\n")}`;

  return {
    Small: smallSkill,
    Medium: mediumSkills,
    Large: largeSkills,
    Maximum: maximumSkills
  };
}

export function runBenchmark(): BenchmarkReportItem[] {
  const fixtures = createBenchmarkFixtures();
  const results: BenchmarkReportItem[] = [];

  const optimizers: Array<{ name: "Default" | "Ponytail"; instance: TokenOptimizer }> = [
    { name: "Default", instance: new DefaultTokenOptimizer({ maxTokens: 6000 }) },
    { name: "Ponytail", instance: new PonytailTokenOptimizer({ maxTokens: 6000, mode: "full" }) }
  ];

  for (const [fixtureName, text] of Object.entries(fixtures) as Array<["Small" | "Medium" | "Large" | "Maximum", string]>) {
    for (const opt of optimizers) {
      const inputTokens = estimateTokens(text);
      const start = performance.now();
      const res = opt.instance.optimize({ text, estimatedTokens: inputTokens });
      const durationMs = Number((performance.now() - start).toFixed(3));

      // Validate protected content
      const rulesValid = !text.includes("#### Rules") || res.text.includes("#### Rules");
      const workflowValid = !text.includes("#### Workflow") || res.text.includes("#### Workflow");
      const antiPatternsValid = !text.includes("#### Anti-Patterns") || res.text.includes("#### Anti-Patterns");
      const protectedContentValid = rulesValid && workflowValid && antiPatternsValid;

      results.push({
        fixture: fixtureName,
        optimizer: opt.name,
        inputTokens,
        outputTokens: res.optimizedEstimatedTokens,
        tokensSaved: res.metrics.tokensSaved,
        reductionRatio: res.metrics.reductionRatio,
        durationMs,
        protectedContentValid
      });
    }
  }

  return results;
}
