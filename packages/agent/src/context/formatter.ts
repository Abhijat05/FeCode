import type { CodeContextResult } from "./types.js";

export class CodeContextFormatter {
  public format(result: CodeContextResult): string {
    if (!result || result.regions.length === 0) {
      return "";
    }

    const lines: string[] = ["## Code Context"];

    // Group regions by file path
    const fileRegions = new Map<string, typeof result.regions>();
    for (const region of result.regions) {
      const existing = fileRegions.get(region.path) || [];
      existing.push(region);
      fileRegions.set(region.path, existing);
    }

    for (const [filePath, regions] of fileRegions.entries()) {
      lines.push(`\n### ${filePath}`);
      const ext = filePath.split(".").pop() || "";
      const lang = [
        "tsx",
        "jsx",
        "ts",
        "js",
        "css",
        "scss",
        "html",
        "json",
        "svelte",
        "vue"
      ].includes(ext)
        ? ext
        : "";

      for (const region of regions) {
        lines.push(`\nLines ${region.startLine}-${region.endLine}`);
        if (region.reason) {
          lines.push(`Reason: ${region.reason}`);
        }
        lines.push(`\`\`\`${lang}\n${region.content}\n\`\`\``);
      }
    }

    return lines.join("\n");
  }
}
