import * as path from "path";
import * as os from "os";

export function getDefaultSessionsDir(): string {
  if (process.env.FECODE_SESSIONS_DIR) {
    return path.resolve(process.env.FECODE_SESSIONS_DIR);
  }

  const homedir = os.homedir();
  const platform = process.platform;

  if (platform === "win32") {
    const appdata = process.env.APPDATA;
    if (appdata) {
      return path.join(appdata, "fecode", "sessions");
    }
    return path.join(homedir, ".fecode", "sessions");
  }

  if (platform === "darwin") {
    return path.join(homedir, "Library", "Application Support", "fecode", "sessions");
  }

  // Linux / other Unix-like OS
  const xdgDataHome = process.env.XDG_DATA_HOME;
  if (xdgDataHome) {
    return path.join(xdgDataHome, "fecode", "sessions");
  }

  return path.join(homedir, ".local", "share", "fecode", "sessions");
}
