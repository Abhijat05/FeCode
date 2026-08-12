import { describe, it, expect } from "vitest";
import { DefaultCommandPolicy } from "./policy.js";

describe("DefaultCommandPolicy", () => {
  const policy = new DefaultCommandPolicy();

  it("allows standard frontend tools (npm, npx, pnpm, yarn, bun, node) with arguments", () => {
    const resNpm = policy.validate("npm test");
    expect(resNpm.type).toBe("allowed");
    expect(resNpm.executable).toBe("npm");
    expect(resNpm.args).toEqual(["test"]);

    const resNpx = policy.validate("npx tsc --noEmit");
    expect(resNpx.type).toBe("allowed");
    expect(resNpx.executable).toBe("npx");
    expect(resNpx.args).toEqual(["tsc", "--noEmit"]);

    const resNode = policy.validate("node -v");
    expect(resNode.type).toBe("allowed");
    expect(resNode.executable).toBe("node");

    const resBun = policy.validate("bun run dev");
    expect(resBun.type).toBe("allowed");
    expect(resBun.executable).toBe("bun");
  });

  it("rejects unknown executables and prefixed names like npm-malicious", () => {
    const resMalicious = policy.validate("npm-malicious test");
    expect(resMalicious.type).toBe("denied");
    expect(resMalicious.code).toBe("COMMAND_NOT_ALLOWED");

    const resBash = policy.validate("bash -c 'echo hi'");
    expect(resBash.type).toBe("denied");
    expect(resBash.code).toBe("COMMAND_NOT_ALLOWED");
  });

  it("rejects shell chaining operators (; && ||)", () => {
    const resSemicolon = policy.validate("npm test ; rm -rf /");
    expect(resSemicolon.type).toBe("denied");
    expect(resSemicolon.code).toBe("UNSUPPORTED_SHELL_SYNTAX");

    const resAnd = policy.validate("npm test && npm run build");
    expect(resAnd.type).toBe("denied");
    expect(resAnd.code).toBe("UNSUPPORTED_SHELL_SYNTAX");

    const resOr = policy.validate("npm test || echo fail");
    expect(resOr.type).toBe("denied");
    expect(resOr.code).toBe("UNSUPPORTED_SHELL_SYNTAX");
  });

  it("rejects pipes (|), redirects (>, >>, <), and subshells ($(), ``)", () => {
    const resPipe = policy.validate("npm test | grep pass");
    expect(resPipe.type).toBe("denied");
    expect(resPipe.code).toBe("UNSUPPORTED_SHELL_SYNTAX");

    const resRedirect = policy.validate("npm test > output.txt");
    expect(resRedirect.type).toBe("denied");
    expect(resRedirect.code).toBe("UNSUPPORTED_SHELL_SYNTAX");

    const resSubshell1 = policy.validate("npm test $(whoami)");
    expect(resSubshell1.type).toBe("denied");
    expect(resSubshell1.code).toBe("UNSUPPORTED_SHELL_SYNTAX");

    const resSubshell2 = policy.validate("npm test `id`");
    expect(resSubshell2.type).toBe("denied");
    expect(resSubshell2.code).toBe("UNSUPPORTED_SHELL_SYNTAX");
  });

  it("rejects empty or whitespace-only commands", () => {
    const resEmpty = policy.validate("   ");
    expect(resEmpty.type).toBe("denied");
    expect(resEmpty.code).toBe("INVALID_COMMAND");
  });
});
