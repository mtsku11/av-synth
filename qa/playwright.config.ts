import { defineConfig } from '@playwright/test';

const isCI = !!process.env.CI;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173';
const serverMode = process.env.PLAYWRIGHT_SERVER_MODE ?? 'dev';
const requestedWorkers = Number.parseInt(process.env.PLAYWRIGHT_WORKERS ?? '', 10);
const workers =
  Number.isFinite(requestedWorkers) && requestedWorkers > 0 ? requestedWorkers : isCI ? 1 : 3;

function resolveWebServer():
  | {
      command: string;
      url: string;
      timeout: number;
      reuseExistingServer: boolean;
    }
  | undefined {
  if (serverMode === 'external') return undefined;
  return {
    command: serverMode === 'preview' ? 'npm run preview:http' : 'npm run dev:http',
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  };
}

export default defineConfig({
  testDir: './e2e',
  outputDir: './results/playwright/test-results',
  fullyParallel: false,
  workers,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [['list'], ['html', { outputFolder: './results/playwright/report', open: 'never' }]],
  use: {
    baseURL,
    browserName: 'chromium',
    channel: isCI ? undefined : 'chrome',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The app already records a per-case .webm through its own MediaRecorder
    // capture path. Retaining Playwright's browser video only on failures keeps
    // the debugging path intact without doubling steady-state capture load.
    video: 'retain-on-failure',
    viewport: {
      width: 1440,
      height: 1100,
    },
  },
  webServer: resolveWebServer(),
});
