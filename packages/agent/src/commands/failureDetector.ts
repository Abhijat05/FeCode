export interface MaskedFailureDetection {
  hasMaskedFailure: boolean;
  reason?: string;
  matchedPattern?: string;
}

const TEST_FAILURE_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /(?:^|\n)\s*FAIL\s+[^\n]+/m,
    description: "Test file failure reported (FAIL <file>)"
  },
  {
    pattern: /(?:Test Suites|Tests):\s*.*[1-9]\d*\s+failed/i,
    description: "Test runner summary reported failing tests"
  },
  {
    pattern: /(?:^|\n)\s*Tests failed:\s*[1-9]\d*/mi,
    description: "Test suite reported failing tests count"
  },
  {
    pattern: /(?:^|\n)\s*[1-9]\d*\s+failed,\s*\d+\s+passed/mi,
    description: "Test runner reported failed tests"
  },
  {
    pattern: /(?:^|\n)\s*FAILED\s*\(failures=[1-9]\d*\)/m,
    description: "Unit test runner reported failures"
  },
  {
    pattern: /(?:^|\n)\s*FAILURES!\s*(?:Tests run:.*)?/m,
    description: "Test suite reported FAILURES!"
  },
  {
    pattern: /(?:^|\n)\s*AssertionError(?:\s*\[ERR_ASSERTION\])?:\s*[^\n]+/m,
    description: "Assertion error thrown during execution"
  },
  {
    pattern: /(?:^|\n)\s*ERR!\s+test\b/m,
    description: "npm test error reported (npm ERR! test)"
  }
];

const BUILD_COMPILATION_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /(?:^|\n)[^\n]+:\s*error TS\d+:\s*[^\n]+/m,
    description: "TypeScript compilation error"
  },
  {
    pattern: /(?:^|\n)\s*Found [1-9]\d* errors?(?: in [^\n]+)?\./mi,
    description: "TypeScript compiler reported errors"
  },
  {
    pattern: /(?:^|\n)\s*[1-9]\d* problems? \([1-9]\d* errors?, \d+ warnings?\)/mi,
    description: "ESLint reported lint errors"
  }
];

const SYSTEM_SHELL_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /(?:^|\n)The system cannot find the file specified\./mi,
    description: "Windows system cannot find file specified"
  },
  {
    pattern: /(?:^|\n)The system cannot find the path specified\./mi,
    description: "Windows system cannot find path specified"
  },
  {
    pattern: /(?:^|\n)'[^']+' is not recognized as an internal or external command/mi,
    description: "Command not recognized by system shell"
  },
  {
    pattern: /(?:^|\n)(?:sh|bash|zsh):\s*(?:line\s*\d+:\s*)?[^:\n]+:\s*command not found/mi,
    description: "POSIX shell command not found"
  }
];

const GIT_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /(?:^|\n)fatal:\s*[^\n]+/m,
    description: "Git fatal error encountered"
  },
  {
    pattern: /(?:^|\n)error:\s*failed to push some refs to\b/m,
    description: "Git push failure"
  },
  {
    pattern: /(?:^|\n)CONFLICT \(content\):\s*Merge conflict in\b/m,
    description: "Git merge conflict"
  }
];

/**
 * Inspects stdout and stderr of a command that finished with exitCode 0
 * to detect masked command failures (e.g. test runner failures swallowed by
 * wrapper scripts or compound pipelines, Windows cmd.exe error masking, or git errors).
 */
export function detectMaskedCommandFailure(
  command: string,
  stdout: string = "",
  stderr: string = ""
): MaskedFailureDetection {
  const combined = `${stdout}\n${stderr}`;
  const trimmedCmd = (command || "").trim().toLowerCase();

  // 1. System shell execution errors (file/path not found, command not recognized)
  for (const { pattern, description } of SYSTEM_SHELL_PATTERNS) {
    if (pattern.test(combined)) {
      return {
        hasMaskedFailure: true,
        reason: description,
        matchedPattern: pattern.source
      };
    }
  }

  // 2. Test runner failures
  for (const { pattern, description } of TEST_FAILURE_PATTERNS) {
    if (pattern.test(combined)) {
      return {
        hasMaskedFailure: true,
        reason: description,
        matchedPattern: pattern.source
      };
    }
  }

  // 3. Build & compilation failures
  for (const { pattern, description } of BUILD_COMPILATION_PATTERNS) {
    if (pattern.test(combined)) {
      return {
        hasMaskedFailure: true,
        reason: description,
        matchedPattern: pattern.source
      };
    }
  }

  // 4. Git failures (check stderr always; check stdout unless reading commit logs)
  const isGitLog = trimmedCmd.startsWith("git log") || trimmedCmd.startsWith("git show");
  for (const { pattern, description } of GIT_PATTERNS) {
    if (pattern.test(stderr) || (!isGitLog && pattern.test(stdout))) {
      return {
        hasMaskedFailure: true,
        reason: description,
        matchedPattern: pattern.source
      };
    }
  }

  return { hasMaskedFailure: false };
}
