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

async function createProject(page: import('@playwright/test').Page, name: string) {
  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill(name);
  await page.getByTestId('preprocess-create-project').click();
  await expect(page).toHaveURL(/preprocess_id=/);
}

async function completeLocalization(page: import('@playwright/test').Page) {
  await page.getByTestId('preprocess-step-localize').click();
  const rotatePlusNinety = page.getByTestId('localize-rotate-plus-90');
  await expect(rotatePlusNinety).toBeVisible();
  await rotatePlusNinety.click();
  await expect(page.getByTestId('localize-stage-rotation-value')).toHaveText('90.0°');
  await expect(page.getByTestId('preprocess-step-align')).toBeEnabled({ timeout: 20_000 });
}

test('alignment remains consumer-only after source asset uploads', async ({ page }) => {
  const eosinPath = path.join(process.cwd(), 'tests/fixtures/preprocess/eosin.png');
  const hePath = path.join(process.cwd(), 'tests/fixtures/preprocess/he.png');

  await createProject(page, `task-align-ownership-${Date.now()}`);

  await page.getByTestId('preprocess-step-source-assets').click();
  await uploadFileWithButton(page, /Upload eosin image/i, eosinPath);
  await uploadFileWithButton(page, /Upload H&E image/i, hePath);

  await expect(page.getByTestId('preprocess-step-align')).toBeDisabled();
  await completeLocalization(page);

  await page.getByTestId('preprocess-step-align').click();
  await expect(page.getByRole('button', { name: /Upload H&E image/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Replace H&E image/i })).toHaveCount(0);
  await expect(page.getByTestId('alignment-runtime-status-badge')).toContainText(/ready/i, { timeout: 180_000 });
});

