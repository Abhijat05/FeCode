import * as path from "path";

export function createUnifiedDiff(
  filePath: string,
  originalContent: string,
  proposedContent: string,
  contextLinesCount: number = 3,
  maxDisplayLines: number = 60
): string {
  const normPath = path.normalize(filePath).replace(/\\/g, "/");
  const origLines = originalContent.split("\n");
  const propLines = proposedContent.split("\n");

  const diffLines: string[] = [
    `--- ${normPath}`,
    `+++ ${normPath}`
  ];

  let startIdx = 0;
  while (
    startIdx < origLines.length &&
    startIdx < propLines.length &&
    origLines[startIdx] === propLines[startIdx]
  ) {
    startIdx++;
  }

  let origEnd = origLines.length - 1;
  let propEnd = propLines.length - 1;
  while (
    origEnd >= startIdx &&
    propEnd >= startIdx &&
    origLines[origEnd] === propLines[propEnd]
  ) {
    origEnd--;
    propEnd--;
  }

  if (startIdx > origEnd && startIdx > propEnd) {
    return `--- ${normPath}\n+++ ${normPath}\n@@ (No changes)`;
  }

  const contextStart = Math.max(0, startIdx - contextLinesCount);
  const origContextEnd = Math.min(origLines.length - 1, origEnd + contextLinesCount);

  diffLines.push(`@@ -${contextStart + 1},${origContextEnd - contextStart + 1} @@`);

  for (let i = contextStart; i < startIdx; i++) {
    diffLines.push(` ${origLines[i]}`);
  }

  for (let i = startIdx; i <= origEnd; i++) {
    diffLines.push(`-${origLines[i]}`);
  }

  for (let i = startIdx; i <= propEnd; i++) {
    diffLines.push(`+${propLines[i]}`);
  }

  for (let i = origEnd + 1; i <= origContextEnd; i++) {
    diffLines.push(` ${origLines[i]}`);
  }

  if (diffLines.length > maxDisplayLines) {
    const truncatedLines = diffLines.slice(0, maxDisplayLines);
    truncatedLines.push(`... (diff display truncated; ${diffLines.length - maxDisplayLines} lines omitted) ...`);
    return truncatedLines.join("\n");
  }

  return diffLines.join("\n");
}
