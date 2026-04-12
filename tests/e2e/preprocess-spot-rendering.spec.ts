import path from 'node:path';
import { expect, test } from '@playwright/test';

async function seedProjectWithManySpots(page: import('@playwright/test').Page, chipType: '50um' | '15um') {
  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill(`spot-render-${chipType}-${Date.now()}`);
  await page.getByTestId('preprocess-create-project').click();
  await expect(page).toHaveURL(/preprocess_id=/);

  const url = new URL(page.url());
  const preprocessId = url.searchParams.get('preprocess_id');
  if (!preprocessId) throw new Error('Missing preprocess_id in URL');

  await page.evaluate(({ id, chip }) => {
    const key = 'spatial-preprocess-projects';
    const raw = window.localStorage.getItem(key);
    if (!raw) throw new Error('No preprocess storage payload found');
    const projects = JSON.parse(raw) as Array<Record<string, unknown>>;

    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 320;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable for test seed');
    context.fillStyle = 'rgb(170,170,170)';
    context.fillRect(0, 0, 320, 320);
    const eosinCropDataUrl = canvas.toDataURL('image/png');

    const grid = chip === '50um' ? 50 : 96;
    const totalSpots = grid * grid;
    const projectedSpots: Array<{
      id: string;
      barcode: string;
      arrayRow: number;
      arrayCol: number;
      x: number;
      y: number;
      diameterX: number;
      diameterY: number;
    }> = [];
    for (let i = 0; i < totalSpots; i++) {
      const row = Math.floor(i / grid);
      const col = i % grid;
      projectedSpots.push({
        id: `${chip}-${String(row).padStart(3, '0')}-${String(col).padStart(3, '0')}`,
        barcode: `${chip}-${String(row).padStart(3, '0')}-${String(col).padStart(3, '0')}`,
        arrayRow: row + 1,
        arrayCol: col + 1,
        x: (col + 0.5) / grid,
        y: (row + 0.5) / grid,
        diameterX: 0.01,
        diameterY: 0.01,
      });
    }

    const autoSelected = projectedSpots.slice(0, 100).map((spot) => spot.id);
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
          cropWidth: 320,
          cropHeight: 320,
          qcAccepted: true,
          eosinPreviewDataUrl: eosinCropDataUrl,
          error: null,
        },
        chipConfig: {
          ...(project.chipConfig as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          chipType: chip,
          projectedSpots,
          error: null,
        },
        tissueSelection: {
          ...(project.tissueSelection as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          autoSelectedSpotIds: autoSelected,
          selectedSpotIds: autoSelected,
          forcedInSpotIds: [],
          forcedOutSpotIds: [],
          warning: null,
          paritySummary: {
            selectedCount: autoSelected.length,
            selectedPercent: (autoSelected.length / totalSpots) * 100,
            maskCoverage: (autoSelected.length / totalSpots) * 100,
          },
          error: null,
        },
        exportState: {
          ...(project.exportState as Record<string, unknown>),
          status: 'ready',
          isStale: false,
          updatedAt: now,
          error: null,
        },
      };
    });

    window.localStorage.setItem(key, JSON.stringify(next));
  }, { id: preprocessId, chip: chipType });

  await page.reload();
  await page.getByTestId('preprocess-step-tissue').click();

  return preprocessId;
}

test('feature matches default state', async ({ page }) => {
  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill(`feature-matches-default-${Date.now()}`);
  await page.getByTestId('preprocess-create-project').click();
  await expect(page).toHaveURL(/preprocess_id=/);

  const state = await page.evaluate(() => {
    const raw = window.localStorage.getItem('spatial-preprocess-projects');
    if (!raw) throw new Error('No preprocess storage payload found');

    const projects = JSON.parse(raw) as Array<Record<string, unknown>>;
    const project = projects[0];
    if (!project) throw new Error('Missing seeded project');

    const cropQc = project.cropQc as Record<string, unknown>;
    const featureMatchesPreview = cropQc.featureMatchesPreview as Record<string, unknown> | undefined;

    return {
      featureMatchesPreviewDataUrl: cropQc.featureMatchesPreviewDataUrl,
      featureMatchesPreviewDataUrlNested: featureMatchesPreview?.dataUrl ?? null,
    };
  });

  expect(state.featureMatchesPreviewDataUrl).toBeNull();
  expect(state.featureMatchesPreviewDataUrlNested).toBeNull();
});

test('chip config renders full spot set (no truncation)', async ({ page }) => {
  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill(`chip-full-${Date.now()}`);
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

    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 320;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable for test seed');
    context.fillStyle = 'rgb(170,170,170)';
    context.fillRect(0, 0, 320, 320);
    const eosinCropDataUrl = canvas.toDataURL('image/png');

    const grid = 50;
    const totalSpots = grid * grid;
    const projectedSpots: Array<{
      id: string;
      barcode: string;
      arrayRow: number;
      arrayCol: number;
      x: number;
      y: number;
      diameterX: number;
      diameterY: number;
    }> = [];
    for (let i = 0; i < totalSpots; i++) {
      const row = Math.floor(i / grid);
      const col = i % grid;
      projectedSpots.push({
        id: `50um-${String(row).padStart(3, '0')}-${String(col).padStart(3, '0')}`,
        barcode: `50um-${String(row).padStart(3, '0')}-${String(col).padStart(3, '0')}`,
        arrayRow: row + 1,
        arrayCol: col + 1,
        x: (col + 0.5) / grid,
        y: (row + 0.5) / grid,
        diameterX: 0.01,
        diameterY: 0.01,
      });
    }

    const now = new Date().toISOString();
    const next = projects.map((project) => {
      if (project.id !== id) return project;
      return {
        ...project,
        currentStep: 'chipConfig',
        updatedAt: now,
        localization: {
          ...(project.localization as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          chipBounds: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
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
          eosinPreviewDataUrl: eosinCropDataUrl,
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

  await page.getByTestId('chipconfig-select').selectOption('50um');
  await expect(page.getByTestId('chipconfig-spot-count')).toHaveText('2500');

  const circles = page.getByTestId('chipconfig-stage-canvas').locator('svg circle');
  const circleCount = await circles.count();
  expect(circleCount).toBe(2500);

  await page.screenshot({
    path: path.join(process.cwd(), '.sisyphus/evidence/spot-render-chip-full.png'),
    fullPage: true,
  });
});

test('tissue selection canvas stays mounted with the full projected spot set', async ({ page }) => {
  await seedProjectWithManySpots(page, '50um');

  await expect(page.getByTestId('tissue-stage-canvas')).toBeVisible();
  await expect(page.locator('[data-testid="tissue-stage-canvas"] canvas')).toBeVisible();
  await expect(page.getByTestId('tissue-panel-selected-count')).toHaveText('Selected spots: 100');
  await expect(page.getByTestId('tissue-selected-count')).toHaveText('100');

  await page.screenshot({
    path: path.join(process.cwd(), '.sisyphus/evidence/spot-render-tissue-full.png'),
    fullPage: true,
  });
});

test('tissue selection exposes canvas editing tools', async ({ page }) => {
  await seedProjectWithManySpots(page, '50um');

  await expect(page.getByTestId('tissue-tool-draw')).toBeVisible();
  await expect(page.getByTestId('tissue-tool-edit')).toBeVisible();
  await expect(page.getByTestId('tissue-tool-erase')).toBeVisible();
  await expect(page.getByTestId('tissue-delete-selected')).toBeDisabled();
  await expect(page.getByTestId('tissue-region-row')).toHaveCount(0);

  await page.screenshot({
    path: path.join(process.cwd(), '.sisyphus/evidence/spot-click-toggle.png'),
    fullPage: true,
  });
});

test('opacity slider exists and is functional', async ({ page }) => {
  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill(`opacity-step-${Date.now()}`);
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

    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 320;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable for test seed');
    context.fillStyle = 'rgb(170,170,170)';
    context.fillRect(0, 0, 320, 320);
    const eosinCropDataUrl = canvas.toDataURL('image/png');

    const now = new Date().toISOString();
    const next = projects.map((project) => {
      if (project.id !== id) return project;
      return {
        ...project,
        currentStep: 'cropQc',
        updatedAt: now,
        localization: {
          ...(project.localization as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          chipBounds: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
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
          status: 'ready',
          isStale: false,
          updatedAt: now,
          cropWidth: 320,
          cropHeight: 320,
          qcAccepted: false,
          eosinPreviewDataUrl: eosinCropDataUrl,
          overlayOpacity: 0.5,
          error: null,
        },
      };
    });
    window.localStorage.setItem(key, JSON.stringify(next));
  }, preprocessId);

  await page.reload();
  await page.getByTestId('preprocess-step-crop').click();

  await page.getByRole('tab', { name: 'Overlay opacity' }).click();

  const slider = page.getByTestId('cropqc-overlay-opacity');
  await expect(slider).toBeVisible();

  const thumb = page.getByRole('slider');
  const before = await page.getByText(/Overlay opacity:/).textContent();
  expect(before).toBe('Overlay opacity: 0.50');

  await thumb.focus();
  await page.keyboard.press('ArrowRight');
  const afterOne = await page.getByText(/Overlay opacity:/).textContent();
  expect(afterOne).toBe('Overlay opacity: 0.51');

  await page.keyboard.press('ArrowRight');
  const afterTwo = await page.getByText(/Overlay opacity:/).textContent();
  expect(afterTwo).toBe('Overlay opacity: 0.52');
  await expect(thumb).toHaveAttribute('aria-valuenow', '0.52');

  await page.screenshot({
    path: path.join(process.cwd(), '.sisyphus/evidence/opacity-slider-step.png'),
    fullPage: true,
  });
});

test('tissue align preview is enlarged', async ({ page }) => {
  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill(`align-preview-${Date.now()}`);
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

    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 320;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable for test seed');
    context.fillStyle = 'rgb(170,170,170)';
    context.fillRect(0, 0, 320, 320);
    const checkerboardDataUrl = canvas.toDataURL('image/png');

    const now = new Date().toISOString();
    const next = projects.map((project) => {
      if (project.id !== id) return project;
      return {
        ...project,
        currentStep: 'cropQc',
        updatedAt: now,
        localization: {
          ...(project.localization as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          chipBounds: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
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
          status: 'ready',
          isStale: false,
          updatedAt: now,
          cropWidth: 320,
          cropHeight: 320,
          qcAccepted: false,
          checkerboardPreviewDataUrl: checkerboardDataUrl,
          error: null,
        },
      };
    });
    window.localStorage.setItem(key, JSON.stringify(next));
  }, preprocessId);

  await page.reload();
  await page.getByTestId('preprocess-step-crop').click();

  const preview = page.getByTestId('cropqc-spatial-align-canvas');
  const box = await preview.boundingBox();
  if (!box) throw new Error('Missing tissue align preview bounds');

  expect(box.width).toBeGreaterThan(220);
  expect(box.height).toBeGreaterThan(220);

  await page.screenshot({
    path: path.join(process.cwd(), '.sisyphus/evidence/tissue-align-preview-enlarged.png'),
    fullPage: true,
  });
});

test('feature matches tab shows placeholder before generation', async ({ page }) => {
  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill(`feature-matches-placeholder-${Date.now()}`);
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

    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 320;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable for test seed');
    context.fillStyle = 'rgb(170,170,170)';
    context.fillRect(0, 0, 320, 320);
    const checkerboardDataUrl = canvas.toDataURL('image/png');

    const now = new Date().toISOString();
    const next = projects.map((project) => {
      if (project.id !== id) return project;
      return {
        ...project,
        currentStep: 'cropQc',
        updatedAt: now,
        localization: {
          ...(project.localization as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          chipBounds: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
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
          status: 'ready',
          isStale: false,
          updatedAt: now,
          cropWidth: 320,
          cropHeight: 320,
          qcAccepted: false,
          checkerboardPreviewDataUrl: checkerboardDataUrl,
          featureMatchesPreviewDataUrl: null,
          featureMatchesPreview: { dataUrl: null },
          error: null,
        },
      };
    });
    window.localStorage.setItem(key, JSON.stringify(next));
  }, preprocessId);

  await page.reload();
  await page.getByTestId('preprocess-step-crop').click();
  await page.getByRole('tab', { name: 'Feature matches' }).click();

  await expect(page.getByText('Feature-match preview appears after crop generation.')).toBeVisible();
  await expect(page.getByTestId('cropqc-feature-matches-canvas')).toHaveCount(0);
});
