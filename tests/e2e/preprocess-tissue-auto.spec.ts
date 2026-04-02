import path from 'node:path';
import { expect, test } from '@playwright/test';

async function seedProjectToTissueReady(page: import('@playwright/test').Page) {
  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill(`task8-tissue-${Date.now()}`);
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

    const grid = 50;
    const canvas = document.createElement('canvas');
    canvas.width = grid;
    canvas.height = grid;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable for test seed');
    context.fillStyle = 'rgb(160,160,160)';
    context.fillRect(0, 0, grid, grid);
    const eosinCropDataUrl = canvas.toDataURL('image/png');

    const projectedSpots = Array.from({ length: grid * grid }, (_, index) => {
      const row = Math.floor(index / grid) + 1;
      const col = (index % grid) + 1;
      return {
        id: `50um-${String(row).padStart(3, '0')}-${String(col).padStart(3, '0')}`,
        barcode: `50um-${String(row).padStart(3, '0')}-${String(col).padStart(3, '0')}`,
        arrayRow: row,
        arrayCol: col,
        x: (col - 0.5) / grid,
        y: (row - 0.5) / grid,
        diameterX: 0.012,
        diameterY: 0.012,
      };
    });

    const now = new Date().toISOString();
    const next = projects.map((project) => {
      if (project.id !== id) return project;
      return {
        ...project,
        currentStep: 'tissueSelection',
        updatedAt: now,
        cropQc: {
          ...(project.cropQc as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          cropWidth: grid,
          cropHeight: grid,
          qcAccepted: true,
          eosinPreviewDataUrl: eosinCropDataUrl,
          error: null,
        },
        chipConfig: {
          ...(project.chipConfig as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          chipType: '50um',
          projectedSpots,
          error: null,
        },
        tissueSelection: {
          ...(project.tissueSelection as Record<string, unknown>),
          status: 'ready',
          isStale: false,
          updatedAt: now,
          thresholdMode: 'light',
          activationThreshold: 140,
          blockThreshold: 180,
          warning: null,
          selectedSpotIds: [],
          autoSelectedSpotIds: [],
          paritySummary: null,
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
  await page.getByTestId('preprocess-step-tissue').click();
}

test('tissue auto-selection deterministic happy path', async ({ page }) => {
  await seedProjectToTissueReady(page);

  await page.getByTestId('tissue-run-auto').click();

  await expect.poll(async () => Number(await page.getByTestId('tissue-selected-count').innerText())).toBeGreaterThan(0);

  const countText = await page.getByTestId('tissue-selected-count').innerText();
  const count = Number(countText);
  expect(Number.isFinite(count)).toBe(true);
  expect(count).toBeGreaterThan(0);

  const percentText = await page.getByTestId('tissue-selected-percent').innerText();
  const percent = Number(percentText);
  expect(Number.isFinite(percent)).toBe(true);
  expect(percent).toBeGreaterThanOrEqual(0);
  expect(percent).toBeLessThanOrEqual(100);

  await expect(page.getByTestId('tissue-parity-json')).toContainText('thresholdMode');
  await expect(page.getByTestId('tissue-parity-json')).toContainText('selectedCount');

  await page.screenshot({
    path: path.join(process.cwd(), '.sisyphus/evidence/task-8-tissue-auto-happy.png'),
    fullPage: true,
  });
});

test('tissue auto-selection extreme threshold warns and keeps export disabled', async ({ page }) => {
  await seedProjectToTissueReady(page);

  await page.getByTestId('tissue-activation-threshold').fill('255');
  await page.getByTestId('tissue-run-auto').click();

  await expect(page.getByText(/empty or low-confidence/i)).toBeVisible();

  const countText = await page.getByTestId('tissue-selected-count').innerText();
  const count = Number(countText);
  expect(Number.isFinite(count)).toBe(true);
  expect(count).toBeLessThanOrEqual(1);

  await expect(page.getByTestId('preprocess-step-export')).toBeDisabled();

  await page.screenshot({
    path: path.join(process.cwd(), '.sisyphus/evidence/task-8-tissue-auto-error.png'),
    fullPage: true,
  });
});
