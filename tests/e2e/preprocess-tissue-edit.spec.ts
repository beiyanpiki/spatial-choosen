import { expect, test } from '@playwright/test';

async function seedProjectToTissueEditing(page: import('@playwright/test').Page) {
  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill(`task9-tissue-${Date.now()}`);
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

    const coords = [
      { x: 0.2, y: 0.2 },
      { x: 0.3, y: 0.2 },
      { x: 0.4, y: 0.2 },
      { x: 0.7, y: 0.3 },
      { x: 0.75, y: 0.3 },
      { x: 0.8, y: 0.3 },
      { x: 0.2, y: 0.7 },
      { x: 0.75, y: 0.75 },
    ];

    const projectedSpots = coords.map((coord, index) => {
      const n = index + 1;
      return {
        id: `50um-${String(n).padStart(3, '0')}-${String(n).padStart(3, '0')}`,
        barcode: `50um-${String(n).padStart(3, '0')}-${String(n).padStart(3, '0')}`,
        arrayRow: n,
        arrayCol: n,
        x: coord.x,
        y: coord.y,
        diameterX: 0.05,
        diameterY: 0.05,
      };
    });

    const autoSelected = projectedSpots.slice(0, 6).map((spot) => spot.id);
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
          chipType: '50um',
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
            selectedPercent: 75,
            maskCoverage: 75,
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
  }, preprocessId);

  await page.reload();
  await page.getByTestId('preprocess-step-tissue').click();

  return preprocessId;
}

async function readStoredProject(page: import('@playwright/test').Page, preprocessId: string) {
  return page.evaluate((id) => {
    const raw = window.localStorage.getItem('spatial-preprocess-projects');
    if (!raw) return null;
    const projects = JSON.parse(raw) as Array<Record<string, unknown>>;
    return projects.find((project) => project.id === id) ?? null;
  }, preprocessId);
}

async function expectOverridesClearedInStoredSnapshot(page: import('@playwright/test').Page, preprocessId: string) {
  await expect.poll(async () => {
    const stored = await readStoredProject(page, preprocessId);
    if (!stored) return null;
    const tissue = stored.tissueSelection as Record<string, unknown>;
    const exportState = stored.exportState as Record<string, unknown>;
    return {
      forcedInCount: Array.isArray(tissue.forcedInSpotIds) ? tissue.forcedInSpotIds.length : -1,
      forcedOutCount: Array.isArray(tissue.forcedOutSpotIds) ? tissue.forcedOutSpotIds.length : -1,
      regionsCount: Array.isArray(tissue.regions) ? tissue.regions.length : -1,
      overrideNotice: typeof tissue.overrideNotice === 'string' ? tissue.overrideNotice : null,
      exportStatus: typeof exportState.status === 'string' ? exportState.status : null,
      exportIsStale: exportState.isStale === true,
    };
  }).toEqual({
    forcedInCount: 0,
    forcedOutCount: 0,
    regionsCount: 0,
    overrideNotice: 'Overrides cleared due to geometry change.',
    exportStatus: 'stale',
    exportIsStale: true,
  });
}

async function drawPolygonInStage(
  stage: import('@playwright/test').Locator,
  page: import('@playwright/test').Page,
  points: Array<{ x: number; y: number }>,
) {
  const box = await stage.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  });

  const size = Math.min(box.width, box.height);
  const viewportBox = {
    x: box.x + (box.width - size) / 2,
    y: box.y + (box.height - size) / 2,
    width: size,
    height: size,
  };

  const [first, ...rest] = points;
  await page.mouse.move(
    viewportBox.x + first.x * viewportBox.width,
    viewportBox.y + first.y * viewportBox.height,
  );
  await page.mouse.down();

  for (const point of rest) {
    await page.mouse.move(
      viewportBox.x + point.x * viewportBox.width,
      viewportBox.y + point.y * viewportBox.height,
      { steps: 12 },
    );
  }

  await page.mouse.up();
}

test('draw and delete a tissue region on the canvas', async ({ page }) => {
  await seedProjectToTissueEditing(page);

  await page.getByTestId('tissue-tool-draw').click();
  const stage = page.getByTestId('tissue-stage-canvas');
  await stage.scrollIntoViewIfNeeded();
  await drawPolygonInStage(stage, page, [
    { x: 0.20, y: 0.20 },
    { x: 0.55, y: 0.20 },
    { x: 0.55, y: 0.55 },
    { x: 0.20, y: 0.55 },
  ]);

  await expect(page.getByTestId('tissue-region-row')).toHaveCount(1);
  await expect(page.getByTestId('tissue-selected-count')).not.toHaveText('0');

  await page.getByTestId('tissue-tool-edit').click();
  await page.getByTestId('tissue-region-row').first().click();
  await page.getByTestId('tissue-delete-selected').click();

  await expect(page.getByTestId('tissue-region-row')).toHaveCount(0);
});

test('ctrl multi-select keeps both regions selected for bulk delete', async ({ page }) => {
  await seedProjectToTissueEditing(page);

  await page.getByTestId('tissue-tool-draw').click();
  const stage = page.getByTestId('tissue-stage-canvas');
  await stage.scrollIntoViewIfNeeded();

  await drawPolygonInStage(stage, page, [
    { x: 0.18, y: 0.18 },
    { x: 0.38, y: 0.18 },
    { x: 0.38, y: 0.38 },
    { x: 0.18, y: 0.38 },
  ]);
  await drawPolygonInStage(stage, page, [
    { x: 0.62, y: 0.18 },
    { x: 0.82, y: 0.18 },
    { x: 0.82, y: 0.38 },
    { x: 0.62, y: 0.38 },
  ]);

  const rows = page.getByTestId('tissue-region-row');
  await expect(rows).toHaveCount(2);

  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ['ControlOrMeta'] });
  await page.getByTestId('tissue-delete-selected').click();

  await expect(rows).toHaveCount(0);
});

test('ctrl-toggle deselect removes a region from bulk actions', async ({ page }) => {
  await seedProjectToTissueEditing(page);

  await page.getByTestId('tissue-tool-draw').click();
  const stage = page.getByTestId('tissue-stage-canvas');
  await stage.scrollIntoViewIfNeeded();

  await drawPolygonInStage(stage, page, [
    { x: 0.18, y: 0.18 },
    { x: 0.38, y: 0.18 },
    { x: 0.38, y: 0.38 },
    { x: 0.18, y: 0.38 },
  ]);
  await drawPolygonInStage(stage, page, [
    { x: 0.62, y: 0.18 },
    { x: 0.82, y: 0.18 },
    { x: 0.82, y: 0.38 },
    { x: 0.62, y: 0.38 },
  ]);

  const rows = page.getByTestId('tissue-region-row');
  await expect(rows).toHaveCount(2);

  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ['ControlOrMeta'] });
  await rows.nth(1).click({ modifiers: ['ControlOrMeta'] });
  await page.getByTestId('tissue-delete-selected').click();

  await expect(rows).toHaveCount(1);
});

test('punch out removes tissue area from the selected region', async ({ page }) => {
  await seedProjectToTissueEditing(page);

  const stage = page.getByTestId('tissue-stage-canvas');
  await stage.scrollIntoViewIfNeeded();

  await page.getByTestId('tissue-tool-draw').click();
  await drawPolygonInStage(stage, page, [
    { x: 0.18, y: 0.18 },
    { x: 0.75, y: 0.18 },
    { x: 0.75, y: 0.75 },
    { x: 0.18, y: 0.75 },
  ]);

  const before = Number(await page.getByTestId('tissue-selected-count').innerText());

  await page.getByTestId('tissue-tool-edit').click();
  await page.getByTestId('tissue-region-row').first().click();
  await page.getByTestId('tissue-tool-erase').click();
  await drawPolygonInStage(stage, page, [
    { x: 0.67, y: 0.27 },
    { x: 0.73, y: 0.27 },
    { x: 0.73, y: 0.33 },
    { x: 0.67, y: 0.33 },
  ]);

  const after = Number(await page.getByTestId('tissue-selected-count').innerText());
  expect(after).toBeLessThan(before);
});

test('rerunning auto-selection preserves manual region-derived selection', async ({ page }) => {
  await seedProjectToTissueEditing(page);

  await page.getByTestId('tissue-tool-draw').click();
  const stage = page.getByTestId('tissue-stage-canvas');
  await stage.scrollIntoViewIfNeeded();
  await drawPolygonInStage(stage, page, [
    { x: 0.18, y: 0.18 },
    { x: 0.75, y: 0.18 },
    { x: 0.75, y: 0.75 },
    { x: 0.18, y: 0.75 },
  ]);

  await expect(page.getByTestId('tissue-region-row')).toHaveCount(1);
  const before = await page.getByTestId('tissue-selected-count').innerText();

  await page.getByTestId('tissue-run-auto').click();

  await expect(page.getByTestId('tissue-region-row')).toHaveCount(1);
  await expect(page.getByTestId('tissue-selected-count')).toHaveText(before);
});

test('geometry change clears overrides and keeps export stale', async ({ page }) => {
  await seedProjectToTissueEditing(page);

  await page.getByTestId('tissue-tool-draw').click();
  const stage = page.getByTestId('tissue-stage-canvas');
  await stage.scrollIntoViewIfNeeded();
  await drawPolygonInStage(stage, page, [
    { x: 0.20, y: 0.20 },
    { x: 0.55, y: 0.20 },
    { x: 0.55, y: 0.55 },
    { x: 0.20, y: 0.55 },
  ]);
  await expect(page.getByTestId('tissue-region-row')).toHaveCount(1);

  await page.getByTestId('preprocess-step-chip').click();
  await page.getByTestId('chipconfig-select').selectOption('15um');
  await expect(page.getByTestId('preprocess-step-tissue')).toBeEnabled();

  await page.getByTestId('preprocess-step-tissue').click();
  await expect(page.getByText(/overrides cleared due to geometry change/i)).toBeVisible();
  await expect(page.getByTestId('tissue-region-row')).toHaveCount(0);
  await expect(page.getByTestId('preprocess-step-export')).toBeDisabled();
});

test('localization geometry change clears overrides in persisted snapshot', async ({ page }) => {
  const preprocessId = await seedProjectToTissueEditing(page);

  await page.getByTestId('tissue-tool-draw').click();
  const stage = page.getByTestId('tissue-stage-canvas');
  await stage.scrollIntoViewIfNeeded();
  await drawPolygonInStage(stage, page, [
    { x: 0.20, y: 0.20 },
    { x: 0.55, y: 0.20 },
    { x: 0.55, y: 0.55 },
    { x: 0.20, y: 0.55 },
  ]);
  await expect(page.getByTestId('tissue-region-row')).toHaveCount(1);

  await page.getByTestId('preprocess-step-localize').click();
  await page.getByRole('tab', { name: 'Transform' }).click();
  await page.getByTestId('localize-flip-horizontal').click();
  await page.getByTestId('preprocess-step-source-assets').click();

  await expectOverridesClearedInStoredSnapshot(page, preprocessId);
});
