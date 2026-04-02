import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/playwright-artifacts',
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    viewport: { width: 1440, height: 1024 },
    deviceScaleFactor: 1,
    trace: 'on',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/preprocess',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
