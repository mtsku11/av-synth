import fs from 'node:fs';
import path from 'node:path';

import { findArtifact } from './artifacts.js';

const ROOT = process.cwd();
const CASES_DIR = path.join(ROOT, 'qa/cases');
const RESULTS_DIR = path.join(ROOT, 'qa/results/playwright/test-results');
const REFERENCES_DIR = path.join(ROOT, 'qa/references');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
  const source = findArtifact(RESULTS_DIR, qaCase.id, filename);
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
