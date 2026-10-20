import os from "node:os";

/**
 * Collapses an absolute directory path to a tilde-prefixed path if it resides
 * inside the user's home directory. Normalizes path separators to forward slashes.
 */
export function formatCwd(dir: string): string {
  if (!dir) return "";
  try {
    const home = os.homedir();
    const envHome = process.env.HOME || process.env.USERPROFILE || "";
    const effectiveHome = home || envHome;
    if (effectiveHome) {
      const normDir = dir.replace(/\\/g, "/");
      const normHome = effectiveHome.replace(/\\/g, "/");

      if (
        normDir.toLowerCase() === normHome.toLowerCase() ||
        normDir.toLowerCase() === normHome.toLowerCase() + "/"
      ) {
        return "~";
      }

      if (normDir.toLowerCase().startsWith(normHome.toLowerCase() + "/")) {
        const sub = normDir.slice(normHome.length);
        return "~" + (sub.startsWith("/") ? sub : "/" + sub);
      }
    }
  } catch {
    // fallback
  }
  return dir;
}
