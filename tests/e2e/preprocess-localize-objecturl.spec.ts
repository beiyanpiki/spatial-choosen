import path from 'node:path';
import { expect, test } from '@playwright/test';

async function createProject(page: import('@playwright/test').Page, name: string) {
  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill(name);
  await page.getByTestId('preprocess-create-project').click();
  await expect(page).toHaveURL(/preprocess_id=/);
}

test('localize mutations do not revoke the active source image URL', async ({ page }) => {
  const eosinPath = path.join(process.cwd(), 'tests/fixtures/preprocess/eosin.png');

  await createProject(page, `localize-objecturl-${Date.now()}`);
  await page.getByTestId('preprocess-step-localize').click();
  await page.getByRole('button', { name: /Upload eosin image/i }).click();
  await page.locator('input[type="file"]').first().setInputFiles(eosinPath);

  await expect(page.getByText('No eosin image loaded')).toBeHidden();

  await page.getByRole('tab', { name: 'Transform' }).click();
  await page.getByTestId('localize-flip-horizontal').click();

  await page.getByTestId('preprocess-step-align').click();
  await expect(page.getByText('No eosin image loaded')).toBeHidden();
  await expect(page.getByText('Eosin: eosin.png')).toBeVisible();
  const consoleMessages = await page.consoleMessages();
  expect(consoleMessages.filter((message) => message.type() === 'error').map((message) => message.text())).not.toContain(
    expect.stringContaining('ERR_FILE_NOT_FOUND'),
  );
});
