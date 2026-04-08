import path from 'node:path';
import { expect, test } from '@playwright/test';

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
  await expect(page.getByTestId('he-focus-focused-image-card')).toContainText('Restored');
  await expect(page.getByTestId('he-focus-focused-image-preview')).toBeVisible();
});
