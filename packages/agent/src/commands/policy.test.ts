import { describe, it, expect } from "vitest";
import { DefaultCommandPolicy, hasUnquotedForbiddenChars } from "./policy.js";

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

    const resGit = policy.validate("git status");
    expect(resGit.type).toBe("allowed");
    expect(resGit.executable).toBe("git");
    expect(resGit.args).toEqual(["status"]);
  });

  it("rejects unknown executables and provides redirection hints for file utilities", () => {
    const resMalicious = policy.validate("npm-malicious test");
    expect(resMalicious.type).toBe("denied");
    expect(resMalicious.code).toBe("COMMAND_NOT_ALLOWED");

    const resBash = policy.validate("bash -c 'echo hi'");
    expect(resBash.type).toBe("denied");
    expect(resBash.code).toBe("COMMAND_NOT_ALLOWED");

    const resCat = policy.validate("cat package.json");
    expect(resCat.type).toBe("denied");
    expect(resCat.code).toBe("COMMAND_NOT_ALLOWED");
    expect(resCat.reason).toContain("use the 'read_file' tool directly");

    const resFind = policy.validate("find . -name '*.ts'");
    expect(resFind.type).toBe("denied");
    expect(resFind.code).toBe("COMMAND_NOT_ALLOWED");
    expect(resFind.reason).toContain("use the 'search_files' or 'list_directory' tool directly");
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

  it("rejects newline command injection (\\n, \\r, \\r\\n)", () => {
    const resLf = policy.validate("npm test\ncalc.exe");
    expect(resLf.type).toBe("denied");
    expect(resLf.code).toBe("UNSUPPORTED_SHELL_SYNTAX");

    const resCrlf = policy.validate("npm test\r\necho pwned");
    expect(resCrlf.type).toBe("denied");
    expect(resCrlf.code).toBe("UNSUPPORTED_SHELL_SYNTAX");

    const resCr = policy.validate("npm test\rcalc.exe");
    expect(resCr.type).toBe("denied");
    expect(resCr.code).toBe("UNSUPPORTED_SHELL_SYNTAX");
  });
});

describe("hasUnquotedForbiddenChars — honorSingleQuotes option (Windows shell-injection fix)", () => {
  // cmd.exe (used via shell:true for Windows batch executables like npm/npx)
  // assigns no special meaning to single quotes, unlike the shell:false argv
  // path. A string such as `npm install 'x & del /s /q C:\Users'` must still
  // be flagged when it is about to be handed to that real shell, even though
  // it looks "safely quoted" to the default (shell:false-oriented) scan.

  it("treats single-quoted regions as safe by default, matching the shell:false argv path", () => {
    expect(hasUnquotedForbiddenChars("install 'x & del /s /q C:\\Users'")).toBe(false);
  });

  it("flags metacharacters inside single quotes when honorSingleQuotes is false", () => {
    expect(
      hasUnquotedForbiddenChars("install 'x & del /s /q C:\\Users'", {
        honorSingleQuotes: false
      })
    ).toBe(true);
  });

  it("still honors double quotes as a safe region even when honorSingleQuotes is false", () => {
    expect(
      hasUnquotedForbiddenChars('install "package-name"', { honorSingleQuotes: false })
    ).toBe(false);
  });

  it("still flags $() subshells inside double quotes regardless of the option", () => {
    expect(
      hasUnquotedForbiddenChars('install "$(whoami)"', { honorSingleQuotes: false })
    ).toBe(true);
  });

  it("flags bare, unquoted forbidden characters regardless of the option", () => {
    expect(hasUnquotedForbiddenChars("install pkg & calc.exe")).toBe(true);
    expect(
      hasUnquotedForbiddenChars("install pkg & calc.exe", { honorSingleQuotes: false })
    ).toBe(true);
  });
});
