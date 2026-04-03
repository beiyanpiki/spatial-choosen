import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

async function createProject(page: import('@playwright/test').Page, name: string) {
  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill(name);
  await page.getByTestId('preprocess-create-project').click();
  await expect(page).toHaveURL(/preprocess_id=/);
}

async function uploadAlignmentImages(page: import('@playwright/test').Page) {
  const eosinPath = path.join(process.cwd(), 'tests/fixtures/preprocess/eosin.png');
  const hePath = path.join(process.cwd(), 'tests/fixtures/preprocess/he.png');

  await page.getByTestId('preprocess-step-localize').click();
  await page.getByRole('button', { name: /Upload eosin image/i }).click();
  await page.locator('input[type="file"]').first().setInputFiles(eosinPath);
  await expect(page.getByTestId('preprocess-step-align')).toBeEnabled();

  await page.getByTestId('preprocess-step-align').click();
  await page.getByRole('button', { name: /Upload H&E image/i }).click();
  await page.locator('input[type="file"]').last().setInputFiles(hePath);
  await expect(page.getByTestId('alignment-runtime-status-badge')).toContainText(/ready/i, { timeout: 180_000 });
}

async function addTenIdentityPairs(page: import('@playwright/test').Page) {
  const points = [
    { x: 0.12, y: 0.14 },
    { x: 0.22, y: 0.18 },
    { x: 0.34, y: 0.24 },
    { x: 0.46, y: 0.32 },
    { x: 0.16, y: 0.42 },
    { x: 0.28, y: 0.52 },
    { x: 0.4, y: 0.6 },
    { x: 0.52, y: 0.68 },
    { x: 0.2, y: 0.74 },
    { x: 0.58, y: 0.2 },
  ];

  for (const point of points) {
    await clickAlignmentPoint(page, 'alignment-add-point-eosin', point);
    await clickAlignmentPoint(page, 'alignment-add-point-he', point);
  }

  await expect(page.getByTestId('alignment-pair-count-badge')).toContainText('Pairs 10 / 10');
}

async function addTenClusteredPairs(page: import('@playwright/test').Page) {
  const points = [
    { x: 0.24, y: 0.28 },
    { x: 0.26, y: 0.29 },
    { x: 0.28, y: 0.3 },
    { x: 0.3, y: 0.31 },
    { x: 0.32, y: 0.32 },
    { x: 0.34, y: 0.33 },
    { x: 0.36, y: 0.34 },
    { x: 0.38, y: 0.35 },
    { x: 0.4, y: 0.36 },
    { x: 0.42, y: 0.37 },
  ];

  for (const point of points) {
    await clickAlignmentPoint(page, 'alignment-add-point-eosin', point);
    await clickAlignmentPoint(page, 'alignment-add-point-he', point);
  }

  await expect(page.getByTestId('alignment-pair-count-badge')).toContainText('Pairs 10 / 10');
}

async function clickAlignmentPoint(
  page: import('@playwright/test').Page,
  canvasTestId: 'alignment-add-point-eosin' | 'alignment-add-point-he',
  point: { x: number; y: number },
) {
  const canvas = page.getByTestId(canvasTestId);
  const image = canvas.locator('img');
  await expect(canvas).toBeVisible();
  await expect(image).toBeVisible();
  const clickPosition = await image.evaluate((img, p) => {
    const imageRect = img.getBoundingClientRect();
    const canvasRect = img.parentElement?.parentElement?.getBoundingClientRect() ?? img.parentElement?.getBoundingClientRect() ?? imageRect;
    return {
      x: imageRect.left - canvasRect.left + imageRect.width * p.x,
      y: imageRect.top - canvasRect.top + imageRect.height * p.y,
    };
  }, point);
  await canvas.click({ position: clickPosition });
}

async function getAlignmentImageBox(
  page: import('@playwright/test').Page,
  canvasTestId: 'alignment-add-point-eosin' | 'alignment-add-point-he',
) {
  return page.getByTestId(canvasTestId).locator('img').evaluate((img) => {
    const imageRect = img.getBoundingClientRect();
    const canvasRect = img.parentElement?.parentElement?.getBoundingClientRect() ?? img.parentElement?.getBoundingClientRect() ?? imageRect;

    return {
      left: Math.round(imageRect.left - canvasRect.left),
      top: Math.round(imageRect.top - canvasRect.top),
      width: Math.round(imageRect.width),
      height: Math.round(imageRect.height),
    };
  });
}

test('adding one landmark pair creates one point per canvas', async ({ page }) => {
  await createProject(page, `task12-single-pair-${Date.now()}`);
  await uploadAlignmentImages(page);

  await expect(page.getByTestId('alignment-add-point-eosin')).toBeVisible();
  await expect(page.getByTestId('alignment-add-point-he')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Eosin landmarks' })).toHaveCount(0);

  await clickAlignmentPoint(page, 'alignment-add-point-eosin', { x: 0.2, y: 0.2 });
  await clickAlignmentPoint(page, 'alignment-add-point-he', { x: 0.2, y: 0.2 });

  await expect(page.getByTestId('alignment-pair-count-badge')).toContainText('Pairs 1 / 10');

  await expect(page.getByTestId('alignment-add-point-eosin').locator('svg circle')).toHaveCount(1);
  await expect(page.getByTestId('alignment-add-point-he').locator('svg circle')).toHaveCount(1);
});

test('workspace edits persist only after step transition save', async ({ page }) => {
  const initialName = `task12-save-initial-${Date.now()}`;
  const deferredName = `task12-save-deferred-${Date.now()}`;
  const persistedName = `task12-save-persisted-${Date.now()}`;

  await createProject(page, initialName);

  const nameInput = page.locator('input').first();
  await nameInput.fill(deferredName);
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator(`input[value="${initialName}"]`)).toBeVisible();

  await nameInput.fill(persistedName);
  await page.getByTestId('preprocess-step-localize').click();
  await expect(page.getByTestId('autosave-status')).toContainText(/saved|saving/i);
  await page.waitForTimeout(1200);
  await page.reload();

  await expect(page.locator(`input[value="${persistedName}"]`)).toBeVisible();
  await expect(page.getByText('Chip localization')).toBeVisible();
});

test('localize transform exposes zoom control', async ({ page }) => {
  await createProject(page, `task12-localize-zoom-${Date.now()}`);
  await page.getByTestId('preprocess-step-localize').click();
  await expect(page.getByTestId('localize-scale-slider')).toBeVisible();
});

test('align exposes HE transform controls and wheel zoom does not scroll page', async ({ page }) => {
  await createProject(page, `task12-align-he-controls-${Date.now()}`);
  await uploadAlignmentImages(page);
  await expect(page.getByText(/Landmark alignment can now target this image/i)).toBeHidden({ timeout: 10_000 });

  await expect(page.getByTestId('alignment-he-rotation-slider')).toBeVisible();
  await expect(page.getByTestId('alignment-he-scale-slider')).toBeVisible();
  await expect(page.getByTestId('alignment-he-flip-horizontal')).toBeVisible();

  const beforeScroll = await page.evaluate(() => window.scrollY);
  const canvas = page.getByTestId('alignment-add-point-eosin');
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await page.mouse.move((canvasBox?.x ?? 0) + 220, (canvasBox?.y ?? 0) + 220);
  await page.mouse.wheel(0, 600);
  const afterScroll = await page.evaluate(() => window.scrollY);
  expect(afterScroll).toBe(beforeScroll);
});

test('dragging alignment background pans one canvas independently', async ({ page }) => {
  await createProject(page, `task12-align-pan-${Date.now()}`);
  await uploadAlignmentImages(page);

  await expect(page.getByText(/Landmark alignment can now target this image/i)).toBeHidden({ timeout: 10_000 });

  const before = await getAlignmentImageBox(page, 'alignment-add-point-eosin');
  const canvas = page.getByTestId('alignment-add-point-eosin');
  await canvas.scrollIntoViewIfNeeded();
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();

  await page.mouse.move((canvasBox?.x ?? 0) + (canvasBox?.width ?? 0) * 0.45, (canvasBox?.y ?? 0) + (canvasBox?.height ?? 0) * 0.45);
  await page.mouse.down();
  await page.mouse.move((canvasBox?.x ?? 0) + (canvasBox?.width ?? 0) * 0.65, (canvasBox?.y ?? 0) + (canvasBox?.height ?? 0) * 0.6, { steps: 12 });
  await page.mouse.up();

  const after = await getAlignmentImageBox(page, 'alignment-add-point-eosin');
  expect(after.left).not.toBe(before.left);
});

test('repeated solve/reset stays stable and crop step remains reachable', async ({ page }) => {
  test.setTimeout(60_000);
  await createProject(page, `task12-hardening-cycles-${Date.now()}`);
  await uploadAlignmentImages(page);

  for (let cycle = 0; cycle < 5; cycle += 1) {
    await addTenIdentityPairs(page);
    await page.getByTestId('alignment-run-solve').click();
    await expect(page.getByTestId('alignment-status')).toContainText(/Accepted|Rejected/i);
    await page.getByTestId('alignment-reset').click();
    await expect(page.getByTestId('alignment-pair-count-badge')).toContainText('Pairs 0 / 10');
  }

  await addTenIdentityPairs(page);
  await page.getByTestId('alignment-run-solve').click();
  await expect(page.getByTestId('alignment-status')).toContainText(/Accepted/i);
  await expect(page.getByTestId('preprocess-step-crop')).toBeEnabled();

  await page.screenshot({
    path: path.join(process.cwd(), '.sisyphus/evidence/task-12-hardening-happy.png'),
    fullPage: true,
  });
});

test('clustered landmarks stay blocked after solve and keep crop disabled', async ({ page }) => {
  await createProject(page, `task12-clustered-coverage-${Date.now()}`);
  await uploadAlignmentImages(page);

  await addTenClusteredPairs(page);
  await expect(page.getByTestId('alignment-distribution-warning')).toBeVisible();

  await page.getByTestId('alignment-run-solve').click();

  await expect(page.getByTestId('alignment-status')).toContainText(/Rejected|Not solved/i);
  await expect(page.getByTestId('alignment-status')).toHaveAttribute('data-solve-accepted', 'false');
  await expect(page.getByTestId('preprocess-step-crop')).toBeDisabled();
});

test('oversized input and synthetic quota failure surface recoverable errors', async ({ page }) => {
  await createProject(page, `task12-hardening-errors-${Date.now()}`);

  const oversizedPath = path.join(process.cwd(), 'test-results', `oversized-${Date.now()}.png`);
  await fs.mkdir(path.dirname(oversizedPath), { recursive: true });
  await fs.writeFile(oversizedPath, '');
  await fs.truncate(oversizedPath, 512 * 1024 * 1024 + 1);
  await page.getByTestId('preprocess-step-localize').click();
  await page.getByRole('button', { name: /Upload eosin image/i }).click();
  await page.locator('input[type="file"]').first().setInputFiles(oversizedPath);

  await expect(page.getByText(/exceeds/i)).toBeVisible();

  const eosinPath = path.join(process.cwd(), 'tests/fixtures/preprocess/eosin.png');
  await page.getByRole('button', { name: /Upload eosin image/i }).click();
  await page.locator('input[type="file"]').first().setInputFiles(eosinPath);
  await expect(page.getByTestId('preprocess-step-align')).toBeEnabled();

  await page.evaluate(() => {
    (window as unknown as { __PREPROCESS_TEST_FORCE_QUOTA__?: boolean }).__PREPROCESS_TEST_FORCE_QUOTA__ = true;
  });

  const nameInput = page.locator('input').first();
  await nameInput.fill(`task12-hardening-quota-${Date.now()}`);
  await page.getByTestId('preprocess-step-align').click();

  await expect(page.getByTestId('autosave-status')).toContainText('error');
  await expect(page.getByText('save failed — last saved snapshot preserved')).toBeVisible();

  await page.getByRole('button', { name: /Back to preprocess projects/i }).click();
  await expect(page.getByTestId('preprocess-project-list')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open workspace' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Open workspace' }).first().click();
  await expect(page).toHaveURL(/preprocess_id=/);

  await page.screenshot({
    path: path.join(process.cwd(), '.sisyphus/evidence/task-12-hardening-error.png'),
    fullPage: true,
  });

  await fs.rm(oversizedPath, { force: true });

});
