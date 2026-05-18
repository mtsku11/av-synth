import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CASES_DIR = path.join(ROOT, 'qa/cases');
const RESULTS_DIR = path.join(ROOT, 'qa/results/playwright/test-results');
const REFERENCES_DIR = path.join(ROOT, 'qa/references');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

function findArtifact(caseId, filename) {
  const expectedDirName = `smoke-${caseId}`;
  const expectedPath = path.join(RESULTS_DIR, expectedDirName, filename);
  if (fs.existsSync(expectedPath)) return expectedPath;
  const matches = walk(RESULTS_DIR).filter((file) => path.basename(file) === filename);
  return matches[0] ?? null;
}

const qaCases = fs
  .readdirSync(CASES_DIR)
  .filter((entry) => entry.endsWith('.json'))
  .map((entry) => loadJson(path.join(CASES_DIR, entry)))
  .filter((qaCase) => qaCase.id.startsWith('audit-') && qaCase.recording?.filename);

fs.mkdirSync(REFERENCES_DIR, { recursive: true });

const copied = [];
for (const qaCase of qaCases) {
  const filename = `${qaCase.recording.filename}.webm`;
  const source = findArtifact(qaCase.id, filename);
  if (!source) {
    console.warn(`Skipping ${qaCase.id}: missing artifact ${filename}`);
    continue;
  }
  const target = path.join(REFERENCES_DIR, filename);
  fs.copyFileSync(source, target);
  copied.push(path.relative(ROOT, target));
}

fs.writeFileSync(
  path.join(REFERENCES_DIR, 'manifest.json'),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      count: copied.length,
      files: copied,
    },
    null,
    2,
  )}\n`,
);

console.log(`Copied ${copied.length} reference videos into qa/references`);
