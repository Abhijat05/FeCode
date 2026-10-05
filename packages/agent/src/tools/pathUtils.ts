import * as path from "path";
import * as fs from "fs";

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

function isSubpath(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return (
    rel !== ".." &&
    !rel.startsWith(".." + path.sep) &&
    !rel.startsWith("../") &&
    !path.isAbsolute(rel)
  );
}

export function resolveSafePath(
  cwd: string,
  requestedPath?: string
): SafePathResult | PathErrorResult {
  // 1. Check for Alternate Data Streams (colons in relative path components)
  if (requestedPath) {
    const strippedDrive = requestedPath.replace(/^[a-zA-Z]:[\\/]?/, "");
    if (strippedDrive.includes(":")) {
      return {
        error: {
          message: `Access denied: alternate data streams or stream delimiters are not permitted (${requestedPath}).`,
          code: "PATH_OUT_OF_BOUNDS"
        }
      };
    }
  }

  // 2. Check for reserved DOS device names on Windows
  if (process.platform === "win32" && requestedPath) {
    const segments = requestedPath.split(/[\\/]/);
    for (const segment of segments) {
      if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i.test(segment.trim())) {
        return {
          error: {
            message: `Access denied: reserved device name is not permitted (${requestedPath}).`,
            code: "PATH_OUT_OF_BOUNDS"
          }
        };
      }
    }
  }

  const rootDir = path.resolve(cwd);
  const targetPath = requestedPath
    ? path.resolve(rootDir, requestedPath)
    : rootDir;

  // 3. Lexical bounds check
  if (!isSubpath(rootDir, targetPath)) {
    return {
      error: {
        message: `Access denied: path traversal outside project root is not permitted (${requestedPath || ""}).`,
        code: "PATH_OUT_OF_BOUNDS"
      }
    };
  }

  // 4. Filesystem Canonical Realpath & Symlink / Junction Traversal Verification
  try {
    if (fs.existsSync(rootDir)) {
      const canonicalRoot = fs.realpathSync.native
        ? fs.realpathSync.native(rootDir)
        : fs.realpathSync(rootDir);

      // If the target path exists, verify its canonical destination
      if (fs.existsSync(targetPath)) {
        const canonicalTarget = fs.realpathSync.native
          ? fs.realpathSync.native(targetPath)
          : fs.realpathSync(targetPath);

        if (!isSubpath(canonicalRoot, canonicalTarget)) {
          return {
            error: {
              message: `Access denied: path traversal outside project root is not permitted via symbolic links (${requestedPath || ""}).`,
              code: "PATH_OUT_OF_BOUNDS"
            }
          };
        }
      } else {
        // If targetPath does not exist yet (e.g. for write_file),
        // walk up to find the closest existing ancestor directory and verify its canonical location.
        let probeDir = path.dirname(targetPath);
        while (probeDir && probeDir !== path.dirname(probeDir)) {
          if (fs.existsSync(probeDir)) {
            const canonicalAncestor = fs.realpathSync.native
              ? fs.realpathSync.native(probeDir)
              : fs.realpathSync(probeDir);

            if (!isSubpath(canonicalRoot, canonicalAncestor)) {
              return {
                error: {
                  message: `Access denied: path traversal outside project root is not permitted via symbolic links (${requestedPath || ""}).`,
                  code: "PATH_OUT_OF_BOUNDS"
                }
              };
            }
            break;
          }
          probeDir = path.dirname(probeDir);
        }
      }
    }
  } catch {
    return {
      error: {
        message: `Access denied: unable to safely verify path (${requestedPath || ""}).`,
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
