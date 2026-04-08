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

test('localization unlocks HE Focus before align', async ({ page }) => {
  const eosinPath = path.join(process.cwd(), 'tests/fixtures/preprocess/eosin.png');
  const hePath = path.join(process.cwd(), 'tests/fixtures/preprocess/he.png');

  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill('task6-localize-align-gating');
  await page.getByTestId('preprocess-create-project').click();
  await expect(page).toHaveURL(/preprocess_id=/);

  await page.getByTestId('preprocess-step-source-assets').click();
  await uploadFileWithButton(page, /Upload eosin image/i, eosinPath);
  await uploadFileWithButton(page, /Upload H&E image/i, hePath);

  await page.getByTestId('preprocess-step-localize').click();
  await expect(page.getByTestId('localize-stage-reset')).toBeVisible();
  await page.getByTestId('localize-stage-reset').click();

  await expect(page.getByTestId('preprocess-step-he-focus')).toBeEnabled();
  await expect(page.getByTestId('preprocess-step-align')).toBeDisabled();

  await page.getByTestId('preprocess-step-he-focus').click();
  await expect(page.getByTestId('he-focus-stage-reset')).toBeVisible();
  await page.getByTestId('he-focus-stage-reset').click();
  await expect(page.getByTestId('preprocess-step-align')).toBeEnabled();
});
