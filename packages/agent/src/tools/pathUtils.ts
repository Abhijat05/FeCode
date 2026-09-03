import * as path from "path";

export interface SafePathResult {
  rootDir: string;
  targetPath: string;
  displayPath: string;
}

export interface PathErrorResult {
  error: {
    message: string;
    code: string;
  };
}

export function resolveSafePath(
  cwd: string,
  requestedPath?: string
): SafePathResult | PathErrorResult {
  const rootDir = path.resolve(cwd);
  const targetPath = requestedPath
    ? path.resolve(rootDir, requestedPath)
    : rootDir;

  const relative = path.relative(rootDir, targetPath);
  if (
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    relative.startsWith("../") ||
    path.isAbsolute(relative)
  ) {
    return {
      error: {
        message: `Access denied: path traversal outside project root is not permitted (${requestedPath || ""}).`,
        code: "PATH_OUT_OF_BOUNDS"
      }
    };
  }

  const displayPath = requestedPath ? path.normalize(requestedPath) : ".";

  return {
    rootDir,
    targetPath,
    displayPath
  };
}
