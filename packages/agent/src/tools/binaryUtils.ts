import * as path from "path";
import * as fs from "fs/promises";

export const BINARY_EXTENSIONS = new Set([
  // Executables, binaries, and bytecode
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".wasm",
  ".pyc",
  ".class",
  ".o",
  ".obj",
  // Archives and compressed formats
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".iso",
  ".dmg",
  // Images
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".tiff",
  ".svgz",
  // Documents and Media
  ".pdf",
  ".mp3",
  ".mp4",
  ".wav",
  ".ogg",
  ".flac",
  ".avi",
  ".mov",
  ".mkv",
  // Fonts and Databases
  ".sqlite",
  ".sqlite3",
  ".db",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf"
]);

/**
 * Checks if a file path has an extension known to be a binary format.
 */
export function isBinaryPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Checks if a buffer begins with a known binary magic signature.
 */
export function hasBinaryMagicBytes(buffer: Buffer): boolean {
  if (buffer.length < 2) return false;

  // ELF executable: \x7fELF
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46
  ) {
    return true;
  }

  // Windows PE / DOS executable: MZ (0x4D, 0x5A)
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return true;
  }

  // PDF document: %PDF-
  if (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  ) {
    return true;
  }

  // ZIP archive: PK\x03\x04 or PK\x05\x06
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06)
  ) {
    return true;
  }

  // WASM binary module: \0asm
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x00 &&
    buffer[1] === 0x61 &&
    buffer[2] === 0x73 &&
    buffer[3] === 0x6d
  ) {
    return true;
  }

  // SQLite database: "SQLite format 3\0"
  if (buffer.length >= 16) {
    const sqliteHeader = buffer.subarray(0, 16).toString("ascii");
    if (sqliteHeader === "SQLite format 3\0") {
      return true;
    }
  }

  // PNG image: \x89PNG\r\n\x1a\n
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return true;
  }

  // JPEG image: 0xFF 0xD8 0xFF
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return true;
  }

  // GIF image: GIF87a or GIF89a
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return true;
  }

  // GZIP: 0x1F 0x8B
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return true;
  }

  // Mach-O binary headers
  if (buffer.length >= 4) {
    const b0 = buffer[0];
    const b1 = buffer[1];
    const b2 = buffer[2];
    const b3 = buffer[3];
    if (
      (b0 === 0xfe && b1 === 0xed && b2 === 0xfa && (b3 === 0xce || b3 === 0xcf)) ||
      (b0 === 0xca && b1 === 0xfe && b2 === 0xba && b3 === 0xbe)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Inspects a buffer to determine if it contains binary data.
 * Checks:
 * 1. Known binary magic bytes.
 * 2. Any null (0x00) bytes.
 * 3. Non-whitespace ASCII control character density > 10%.
 */
export function isBinaryBuffer(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;

  if (hasBinaryMagicBytes(buffer)) {
    return true;
  }

  let controlCharCount = 0;
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    if (byte === 0x00) {
      return true; // Any null byte is binary
    }
    // Count non-whitespace control characters: < 0x20 and not \t (0x09), \n (0x0A), \r (0x0D)
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      controlCharCount++;
    }
  }

  // If more than 10% of characters are non-whitespace control characters, classify as binary
  if (controlCharCount / buffer.length > 0.1) {
    return true;
  }

  return false;
}

/**
 * Inspects a file on disk (or via open FileHandle) to determine if it is binary.
 * Samples up to sampleSize bytes (default: 4,096 bytes).
 */
export async function isBinaryFile(
  filePath: string,
  sampleSize: number = 4096
): Promise<boolean> {
  if (isBinaryPath(filePath)) {
    return true;
  }

  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(filePath, "r");
    const stat = await handle.stat();
    if (!stat.isFile()) return false;

    const actualSample = Math.min(stat.size, sampleSize);
    if (actualSample === 0) return false;

    const buffer = Buffer.alloc(actualSample);
    const { bytesRead } = await handle.read(buffer, 0, actualSample, 0);
    return isBinaryBuffer(buffer.subarray(0, bytesRead));
  } catch {
    return false;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // ignore
      }
    }
  }
}
