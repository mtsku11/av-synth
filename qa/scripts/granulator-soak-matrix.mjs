import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const patches = ['no-spawn', 'grainField', 'dense'];
const resultsDir = path.resolve(process.cwd(), 'qa/results');
const summaryPath = path.join(resultsDir, 'granulator-soak-summary.json');
const tracePath = path.join(resultsDir, 'granulator-soak-trace.json');

for (const patch of patches) {
  console.log(`\n[B2.3 matrix] ${patch}`);
  const result = spawnSync(
    'npx',
    ['playwright', 'test', '-c', 'qa/playwright.config.ts', '-g', 'b2.3', '--reporter=list'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        GRANULATOR_SOAK_PATCH: patch,
        PLAYWRIGHT_WORKERS: '1',
      },
    },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
  fs.copyFileSync(summaryPath, path.join(resultsDir, `granulator-soak-${patch}-summary.json`));
  fs.copyFileSync(tracePath, path.join(resultsDir, `granulator-soak-${patch}-trace.json`));
}
