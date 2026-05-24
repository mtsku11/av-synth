import fs from 'node:fs';
import path from 'node:path';

export function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

export function findArtifact(resultsDir, caseId, filename) {
  const matches = walk(resultsDir).filter((file) => path.basename(file) === filename);
  if (!matches.length) return null;
  const caseMatches = matches.filter((file) => file.toLowerCase().includes(caseId.toLowerCase()));
  return caseMatches[0] ?? matches[0] ?? null;
}
