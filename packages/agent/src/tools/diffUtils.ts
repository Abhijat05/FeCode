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
    const half = Math.floor(maxDisplayLines / 2);
    const topLines = diffLines.slice(0, half);
    const bottomLines = diffLines.slice(diffLines.length - half);
    const omitted = diffLines.length - maxDisplayLines;
    return [
      ...topLines,
      `... (diff display truncated; ${omitted} lines omitted) ...`,
      ...bottomLines
    ].join("\n");
  }

  return diffLines.join("\n");
}

export function formatDiffForDisplay(
  diff: string,
  maxDisplayLines: number = 30
): string {
  if (!diff) return "";
  const lines = diff.split("\n");
  if (lines.length <= maxDisplayLines) {
    return diff;
  }
  const half = Math.floor(maxDisplayLines / 2);
  const top = lines.slice(0, half);
  const bottom = lines.slice(lines.length - half);
  const omitted = lines.length - maxDisplayLines;
  return [...top, `... (${omitted} lines omitted) ...`, ...bottom].join("\n");
}

