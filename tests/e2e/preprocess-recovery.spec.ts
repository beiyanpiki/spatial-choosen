import { expect, test } from '@playwright/test';

test('preprocess recovery: workspace persists after reload', async ({ page }) => {
  await page.goto('/preprocess');

  await page.getByPlaceholder('Tumor preprocess set A').fill('playwright-recovery');
  await page.getByTestId('preprocess-create-project').click();

  await expect(page).toHaveURL(/preprocess_id=/);
  const firstUrl = page.url();

  await page.reload();
  await expect(page).toHaveURL(firstUrl);
  await expect(page.getByTestId('preprocess-workspace-shell')).toBeVisible();
  await expect(page.getByTestId('preprocess-step-localize')).toBeVisible();
});
