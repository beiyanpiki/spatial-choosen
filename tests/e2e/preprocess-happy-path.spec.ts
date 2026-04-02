import { expect, test } from '@playwright/test';

test('preprocess happy path: create and reopen workspace shell', async ({ page }) => {
  await page.goto('/preprocess');

  await page.getByPlaceholder('Tumor preprocess set A').fill('playwright-happy-path');
  await page.getByTestId('preprocess-create-project').click();

  await expect(page).toHaveURL(/preprocess_id=/);
  await expect(page.getByTestId('preprocess-workspace-shell')).toBeVisible();
  await expect(page.getByTestId('preprocess-step-localize')).toBeVisible();
  await expect(page.getByTestId('autosave-status')).toContainText(/saving|saved|error/);

  await page.reload();
  await expect(page).toHaveURL(/preprocess_id=/);
  await expect(page.locator('input[value="playwright-happy-path"]')).toBeVisible();
});
