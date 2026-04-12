import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';

async function uploadFileWithButton(
  page: import('@playwright/test').Page,
  buttonName: RegExp,
  filePath: string,
) {
  const uploadButton = page.getByRole('button', { name: buttonName });
  await uploadButton.click();
  await uploadButton.locator('xpath=following-sibling::input[@type="file"][1]').setInputFiles(filePath);
}

async function createPreprocessProject(page: import('@playwright/test').Page) {
  const eosinPath = path.join(process.cwd(), 'tests/fixtures/preprocess/eosin.png');
  const hePath = path.join(process.cwd(), 'tests/fixtures/preprocess/he.png');

  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill(`task6-he-focus-${Date.now()}`);
  await page.getByTestId('preprocess-create-project').click();
  await expect(page).toHaveURL(/preprocess_id=/);

  await page.getByTestId('preprocess-step-source-assets').click();
  await uploadFileWithButton(page, /Upload eosin image/i, eosinPath);
  await uploadFileWithButton(page, /Upload H&E image/i, hePath);
}

async function createLargeSquareFixture(filePath: string, color: { r: number; g: number; b: number }) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await sharp({
    create: {
      width: 2000,
      height: 2000,
      channels: 3,
      background: color,
    },
  }).png().toFile(filePath);
}

test('localize unlocks HE Focus while Align stays blocked and HE Focus exposes its stage controls', async ({ page }) => {
  await createPreprocessProject(page);

  await page.getByTestId('preprocess-step-localize').click();
  await page.getByTestId('localize-stage-reset').click();
  await expect(page.getByTestId('preprocess-step-he-focus')).toBeEnabled();
  await expect(page.getByTestId('preprocess-step-align')).toBeDisabled();

  await page.getByTestId('preprocess-step-he-focus').click();
  await expect(page.getByRole('heading', { name: 'H&E focus canvas' })).toBeVisible();
  await expect(page.getByTestId('he-focus-stage-controls')).toBeVisible();
  await expect(page.getByTestId('he-focus-stage-rotate-right-90')).toBeVisible();
  await expect(page.getByTestId('he-focus-stage-flip-horizontal')).toBeVisible();
  await expect(page.getByTestId('he-focus-stage-reset')).toBeVisible();
  await expect(page.getByTestId('he-focus-focused-image-card')).toBeVisible();

  await page.getByTestId('he-focus-stage-reset').click();
  await expect(page.getByTestId('preprocess-step-align')).toBeEnabled();
  await expect(page.getByTestId('preprocess-step-crop')).toBeDisabled();
});

test('reload preserves completed HE Focus state and downstream visibility', async ({ page }) => {
  await createPreprocessProject(page);

  await page.getByTestId('preprocess-step-localize').click();
  await page.getByTestId('localize-stage-reset').click();
  await page.getByTestId('preprocess-step-he-focus').click();

  const focusedPreview = page.getByTestId('he-focus-focused-image-preview');
  await expect(focusedPreview).toBeVisible();

  await page.getByTestId('he-focus-stage-reset').click();
  await expect(page.getByTestId('autosave-status')).toHaveText('saved');

  await page.reload();

  await expect(page.getByRole('heading', { name: 'H&E focus canvas' })).toBeVisible();
  await expect(page.getByTestId('preprocess-step-he-focus')).toBeEnabled();
  await expect(page.getByTestId('preprocess-step-align')).toBeEnabled();
  await expect(page.getByTestId('preprocess-step-crop')).toBeDisabled();
  await expect(page.getByTestId('he-focus-focused-image-card')).toBeVisible();
  await expect(page.getByTestId('he-focus-focused-image-card')).toContainText('Saved focused H&E preview');
  await expect(page.getByTestId('he-focus-focused-image-preview')).toBeVisible();
});

test('alignment renders the focused HE interaction image at 1000px width for oversized sources', async ({ page }) => {
  const fixtureDir = path.join(process.cwd(), '.sisyphus/evidence/generated-fixtures');
  const eosinPath = path.join(fixtureDir, `large-hefocus-eosin-${Date.now()}.png`);
  const hePath = path.join(fixtureDir, `large-hefocus-he-${Date.now()}.png`);
  await Promise.all([
    createLargeSquareFixture(eosinPath, { r: 180, g: 90, b: 90 }),
    createLargeSquareFixture(hePath, { r: 90, g: 90, b: 180 }),
  ]);

  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill(`task6-he-focus-large-${Date.now()}`);
  await page.getByTestId('preprocess-create-project').click();
  await expect(page).toHaveURL(/preprocess_id=/);

  await page.getByTestId('preprocess-step-source-assets').click();
  await uploadFileWithButton(page, /Upload eosin image/i, eosinPath);
  await uploadFileWithButton(page, /Upload H&E image/i, hePath);

  await page.getByTestId('preprocess-step-localize').click();
  await page.getByTestId('localize-stage-reset').click();
  await page.getByTestId('preprocess-step-he-focus').click();
  await page.getByTestId('he-focus-stage-reset').click();
  await expect(page.getByTestId('preprocess-step-align')).toBeEnabled({ timeout: 20_000 });

  await page.getByTestId('preprocess-step-align').click();

  const displayedMovingSize = await page.getByTestId('alignment-add-point-he').locator('img').evaluate((image) => ({
    width: image.naturalWidth,
    height: image.naturalHeight,
  }));

  expect(displayedMovingSize).toEqual({ width: 1000, height: 1000 });
});
