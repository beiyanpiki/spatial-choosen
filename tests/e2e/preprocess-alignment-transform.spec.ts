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
    const canvasRect = img.parentElement?.parentElement?.getBoundingClientRect()
      ?? img.parentElement?.getBoundingClientRect()
      ?? imageRect;

    return {
      x: imageRect.left - canvasRect.left + imageRect.width * p.x,
      y: imageRect.top - canvasRect.top + imageRect.height * p.y,
    };
  }, point);

  await canvas.click({ position: clickPosition });
}

const targetOffsets = [
  { x: 0.26, y: 0.10 },
  { x: 0.26, y: 0.10 },
  { x: 0.24, y: 0.08 },
  { x: 0.24, y: 0.08 },
  { x: 0.22, y: 0.06 },
  { x: -0.22, y: -0.06 },
  { x: -0.24, y: -0.08 },
  { x: -0.24, y: -0.08 },
  { x: -0.26, y: -0.10 },
  { x: -0.26, y: -0.10 },
] as const;

function makeShearedTarget(point: { x: number; y: number }, index: number) {
  const offset = targetOffsets[index % targetOffsets.length];

  return {
    x: point.x + offset.x,
    y: point.y + offset.y,
  };
}

test('shear-only landmark correspondence is rejected by alignment solve', async ({ page }) => {
  await createProject(page, `task-align-no-shear-${Date.now()}`);
  await uploadAlignmentImages(page);

  const sourcePoints = [
    { x: 0.24, y: 0.2 },
    { x: 0.39, y: 0.2 },
    { x: 0.54, y: 0.2 },
    { x: 0.26, y: 0.4 },
    { x: 0.42, y: 0.45 },
    { x: 0.56, y: 0.5 },
    { x: 0.7, y: 0.55 },
    { x: 0.32, y: 0.65 },
    { x: 0.5, y: 0.72 },
    { x: 0.68, y: 0.76 },
  ];

  for (const [index, sourcePoint] of sourcePoints.entries()) {
    await clickAlignmentPoint(page, 'alignment-add-point-eosin', sourcePoint);
    await clickAlignmentPoint(page, 'alignment-add-point-he', makeShearedTarget(sourcePoint, index));
  }

  await expect(page.getByTestId('alignment-pair-count-badge')).toContainText('Pairs 10 / 10');
  await expect(page.getByTestId('alignment-distribution-warning')).toBeHidden();

  await page.getByTestId('alignment-run-solve').click();

  await expect(page.getByTestId('alignment-status')).toHaveAttribute('data-solve-accepted', 'false');
  await expect(page.getByTestId('preprocess-step-crop')).toBeDisabled();
});
