import path from 'node:path';
import { expect, test } from '@playwright/test';

async function seedProjectToChipReady(page: import('@playwright/test').Page) {
  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill(`task7-chip-${Date.now()}`);
  await page.getByTestId('preprocess-create-project').click();
  await expect(page).toHaveURL(/preprocess_id=/);

  const url = new URL(page.url());
  const preprocessId = url.searchParams.get('preprocess_id');
  if (!preprocessId) throw new Error('Missing preprocess_id in URL');

  await page.evaluate((id) => {
    const key = 'spatial-preprocess-projects';
    const raw = window.localStorage.getItem(key);
    if (!raw) throw new Error('No preprocess storage payload found');
    const projects = JSON.parse(raw) as Array<Record<string, unknown>>;
    const next = projects.map((project) => {
      if (project.id !== id) return project;
      const now = new Date().toISOString();
      return {
        ...project,
        currentStep: 'chipConfig',
        updatedAt: now,
        localization: {
          ...(project.localization as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          chipBounds: (project.localization as Record<string, unknown>).chipBounds ?? { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
        },
        alignment: {
          ...(project.alignment as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          solveAccepted: true,
          error: null,
        },
        cropQc: {
          ...(project.cropQc as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          cropWidth: 320,
          cropHeight: 320,
          qcAccepted: true,
          error: null,
        },
        chipConfig: {
          ...(project.chipConfig as Record<string, unknown>),
          status: 'ready',
          isStale: false,
          updatedAt: now,
          projectedSpots: null,
          error: null,
        },
        tissueSelection: {
          ...(project.tissueSelection as Record<string, unknown>),
          status: 'stale',
          isStale: true,
          updatedAt: now,
          error: null,
        },
        exportState: {
          ...(project.exportState as Record<string, unknown>),
          status: 'stale',
          isStale: true,
          updatedAt: now,
          error: null,
        },
      };
    });
    window.localStorage.setItem(key, JSON.stringify(next));
  }, preprocessId);

  await page.reload();
  await expect(page.getByTestId('preprocess-step-chip')).toBeVisible();
  await page.getByTestId('preprocess-step-chip').click();
}

test('selecting 50um projects 2500 spots', async ({ page }) => {
  await seedProjectToChipReady(page);

  await page.getByTestId('chipconfig-select').selectOption('50um');
  await expect(page.getByTestId('chipconfig-spot-count')).toHaveText('2500');
  await expect(page.getByTestId('preprocess-step-tissue')).toBeEnabled();

  await page.screenshot({
    path: path.join(process.cwd(), '.sisyphus/evidence/task-7-chipconfig-happy.png'),
    fullPage: true,
  });
});

test('malformed manifest blocks tissue progression', async ({ page }) => {
  await seedProjectToChipReady(page);

  await expect(page.getByTestId('chipconfig-select')).toBeEnabled();

  await page.route('**/preprocess-chip-configs/50um/manifest.json', async (route) => {
    await route.fulfill({
      path: path.join(process.cwd(), 'tests/fixtures/preprocess/broken-chip-manifest.json'),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.getByTestId('chipconfig-select').selectOption('50um');
  await expect(page.getByText(/manifest is malformed/i)).toBeVisible();
  await expect(page.getByTestId('chipconfig-spot-count')).toHaveText('0');
  await expect(page.getByTestId('preprocess-step-tissue')).toBeDisabled();

  await page.screenshot({
    path: path.join(process.cwd(), '.sisyphus/evidence/task-7-chipconfig-error.png'),
    fullPage: true,
  });
});
