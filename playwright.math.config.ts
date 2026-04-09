import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*-math.spec.ts',
  outputDir: './test-results/playwright-artifacts',
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  use: {
    viewport: { width: 1440, height: 1024 },
    deviceScaleFactor: 1,
    trace: 'on',
    screenshot: 'only-on-failure',
  },
});
