import type {
  AgentExecutionDecision,
  AgentExecutionStrategy,
  DecisionContext,
  ExecutionIntent,
  ExecutionPhase
} from "./types.js";

export class DefaultAgentExecutionStrategy implements AgentExecutionStrategy {
  public decide(
    message: string,
    context: DecisionContext = {}
  ): AgentExecutionDecision {
    const trimmed = message.trim();
    const lower = trimmed.toLowerCase();

    // 1. Verification Intent
    if (this.isVerificationRequest(lower)) {
      const pm = context.projectProfile?.packageManager || "npm";
      const testTool = context.projectProfile?.testTools?.[0];
      const cmdHint = testTool ? `${pm} test` : `${pm} test`;

      return {
        intent: "verify",
        phase: "verifying",
        shouldExplore: false,
        shouldSelectContext: false,
        requiresPlanning: false,
        recommendedTools: ["execute_command"],
        guidance: `Verify the project using '${cmdHint}'. Observe output before making further changes.`
      };
    }

    // 2. Conceptual Question (Answer Intent)
    if (this.isConceptualQuestion(lower)) {
      return {
        intent: "answer",
        phase: "understanding",
        shouldExplore: false,
        shouldSelectContext: false,
        requiresPlanning: false,
        recommendedTools: [],
        guidance: "Provide a clear, direct answer to the user's conceptual question."
      };
    }

    // 3. Repository Exploration Intent
    if (this.isExplorationQuestion(lower)) {
      return {
        intent: "explore",
        phase: "exploring",
        shouldExplore: true,
        shouldSelectContext: false,
        requiresPlanning: false,
        recommendedTools: ["search_files", "list_directory"],
        guidance: "Explore the repository structure to locate relevant definitions and architecture."
      };
    }

    // 4. Inspection Intent
    if (this.isInspectionQuestion(lower)) {
      return {
        intent: "inspect",
        phase: "understanding",
        shouldExplore: true,
        shouldSelectContext: true,
        requiresPlanning: false,
        recommendedTools: ["read_file", "search_files"],
        guidance: "Inspect the specific component or implementation to understand its behavior before responding."
      };
    }

    // 5. Implementation Intent (Default for coding requests)
    const isComplex = this.isComplexImplementation(trimmed);
    const intent: ExecutionIntent = "implement";
    const phase: ExecutionPhase = isComplex ? "planning" : "implementing";

    const guidanceParts: string[] = [
      "Follow the read-first principle: inspect existing conventions and components before editing."
    ];

    if (context.projectProfile?.framework) {
      guidanceParts.push(`Adhere to project ${context.projectProfile.framework} conventions.`);
    }

    if (context.projectProfile?.packageManager && context.projectProfile.packageManager !== "npm") {
      guidanceParts.push(`Use ${context.projectProfile.packageManager} when running commands.`);
    }

    return {
      intent,
      phase,
      shouldExplore: true,
      shouldSelectContext: true,
      requiresPlanning: isComplex,
      recommendedTools: [
        "search_files",
        "read_file",
        "edit_file",
        "write_file",
        "execute_command"
      ],
      guidance: guidanceParts.join(" ")
    };
  }

  private isVerificationRequest(lower: string): boolean {
    return (
      /^run (the )?(tests?|typecheck|tsc|lint|verification)/.test(lower) ||
      /^check (for )?(type )?errors/.test(lower) ||
      /^verify (the )?(project|build|tests?|code)/.test(lower) ||
      lower === "npm test" ||
      lower === "pnpm test" ||
      lower === "yarn test" ||
      lower === "bun test" ||
      lower === "vitest"
    );
  }

  private isConceptualQuestion(lower: string): boolean {
    const conceptualStarts = [
      "what is react",
      "what is vue",
      "what is svelte",
      "what is typescript",
      "what is javascript",
      "what is a hook",
      "what is a react hook",
      "what is a closure",
      "what is tailwind",
      "explain closures",
      "explain what is",
      "what is the difference between"
    ];

    if (conceptualStarts.some((prefix) => lower.startsWith(prefix))) {
      return true;
    }

    // Questions asking "what is X" without repository terms
    if (
      /^what is (a |an )?[a-z]+(\?)?$/.test(lower) &&
      !lower.includes("file") &&
      !lower.includes("component") &&
      !lower.includes("project")
    ) {
      return true;
    }

    return false;
  }

  private isExplorationQuestion(lower: string): boolean {
    return (
      lower.startsWith("where is") ||
      lower.startsWith("where are") ||
      lower.startsWith("locate ") ||
      lower.startsWith("find the ") ||
      lower.startsWith("which file") ||
      lower.includes("project structure") ||
      lower.includes("project architecture") ||
      lower.includes("overview of the codebase")
    );
  }

  private isInspectionQuestion(lower: string): boolean {
    return (
      lower.startsWith("what does ") ||
      lower.startsWith("how does ") ||
      lower.startsWith("inspect ") ||
      lower.startsWith("show implementation of ") ||
      lower.startsWith("explain how ")
    );
  }

  private isComplexImplementation(message: string): boolean {
    const lower = message.toLowerCase();

    // Check for explicit multi-feature or complex indicators
    const complexIndicators = [
      "with protected routes and tests",
      "and add tests",
      "and write tests",
      "and create tests",
      "full refactor",
      "migration",
      "authentication with",
      "multi-step",
      "end to end"
    ];

    if (complexIndicators.some((ind) => lower.includes(ind))) {
      return true;
    }

    // If long sentence with multiple action conjunctions
    const actionCount = (
      lower.match(/\b(add|create|implement|refactor|update|migrate|integrate)\b/g) || []
    ).length;

    return actionCount >= 2 && lower.length > 50;
  }
}
