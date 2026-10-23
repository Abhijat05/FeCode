/**
 * Native Out-of-Window Attention & Terminal Notifications
 * Emits standard terminal bell (\x07) and OSC 9 escape sequences supported by
 * modern terminals (Windows Terminal, WezTerm, Ghostty, iTerm2, Alacritty, etc.).
 */

export interface NotificationOptions {
  /** Include standard terminal bell (\x07) */
  bell?: boolean;
  /** Include OSC 9 notification sequence */
  osc9?: boolean;
  /** Target stream (defaults to process.stdout) */
  stream?: NodeJS.WriteStream;
  /** Force notification even in non-TTY or test environments */
  force?: boolean;
}

/**
 * Emits an out-of-window notification sequence to the terminal.
 */
export function notifyTerminal(message: string, options: NotificationOptions = {}): boolean {
  const {
    bell = true,
    osc9 = true,
    stream = typeof process !== "undefined" ? process.stdout : undefined,
    force = false
  } = options;

  if (!stream || typeof stream.write !== "function") {
    return false;
  }

  // Safeguard: Do not pollute stdout in automated test environments or non-TTY pipes unless forced
  if (!force) {
    if (typeof process !== "undefined" && process.env.NODE_ENV === "test") {
      return false;
    }
    if (!stream.isTTY) {
      return false;
    }
  }

  const cleanMessage = Array.from(message)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code < 32 || code === 127 ? " " : ch;
    })
    .join("")
    .trim();
  if (!cleanMessage) return false;

  let sequence = "";
  if (osc9) {
    sequence += `\x1b]9;${cleanMessage}\x07`;
  }
  if (bell) {
    sequence += "\x07";
  }

  try {
    stream.write(sequence);
    return true;
  } catch {
    return false;
  }
}

/**
 * Notifies the developer that user approval is required.
 */
export function notifyApprovalRequired(
  targetOrTool: string,
  options?: NotificationOptions
): boolean {
  const label = targetOrTool
    ? `FeCode: Approval required for ${targetOrTool}`
    : "FeCode: Approval required";
  return notifyTerminal(label, options);
}

/**
 * Notifies the developer that an autonomous task has completed.
 */
export function notifyTaskCompleted(
  taskDescription?: string,
  options?: NotificationOptions
): boolean {
  const label = taskDescription
    ? `FeCode: Task complete — ${taskDescription}`
    : "FeCode: Task complete";
  return notifyTerminal(label, options);
}
