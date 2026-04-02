import path from 'node:path';
import { expect, test } from '@playwright/test';

test('localization upload enables align step', async ({ page }) => {
  const eosinPath = path.join(process.cwd(), 'tests/fixtures/preprocess/eosin.png');

  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill('task6-localize-align-gating');
  await page.getByTestId('preprocess-create-project').click();
  await expect(page).toHaveURL(/preprocess_id=/);

  await page.getByTestId('preprocess-step-localize').click();
  await page.getByRole('button', { name: /Upload eosin image/i }).click();
  await page.locator('input[type="file"]').first().setInputFiles(eosinPath);

  await expect(page.getByTestId('preprocess-step-align')).toBeEnabled();
});
