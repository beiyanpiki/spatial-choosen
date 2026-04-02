import path from 'node:path';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('preprocess failure return: malformed import stays on landing', async ({ page }) => {
  await page.goto('/preprocess');

  const beforeCount = await page.getByRole('button', { name: 'Open workspace' }).count();
  const badProjectPath = path.join(process.cwd(), 'tests/fixtures/preprocess/bad-project.json');

  await page.getByTestId('preprocess-import-project').click();
  await page.locator('input[type="file"]').setInputFiles(badProjectPath);

  await expect(page).toHaveURL('/preprocess');
  await expect(page.getByTestId('preprocess-project-list')).toBeVisible();
  const afterCount = await page.getByRole('button', { name: 'Open workspace' }).count();
  expect(afterCount).toBe(beforeCount);
});

test('preprocess failure return: malformed v1 nested payload is rejected before storage', async ({ page }) => {
  const eosinPath = path.join(process.cwd(), 'tests/fixtures/preprocess/eosin.png');
  const hePath = path.join(process.cwd(), 'tests/fixtures/preprocess/he.png');
  const toDataUrl = (filePath: string) => `data:image/png;base64,${readFileSync(filePath).toString('base64')}`;
  const buildImageEntry = (filePath: string, kind: 'eosin' | 'he', width: number, height: number) => ({
    id: `${kind}-broken-import`,
    kind,
    fileName: path.basename(filePath),
    mimeType: 'image/png',
    sizeBytes: readFileSync(filePath).length,
    width,
    height,
    lastModified: null,
    dataUrl: toDataUrl(filePath),
  });

  await page.goto('/preprocess');
  const createdName = `nested-broken-preprocess-${Date.now()}`;
  await page.getByPlaceholder('Tumor preprocess set A').fill(createdName);
  await page.getByTestId('preprocess-create-project').click();
  await expect(page).toHaveURL(/preprocess_id=/);

  const rawProjects = await page.evaluate(() => window.localStorage.getItem('spatial-preprocess-projects'));
  const storedProjects = JSON.parse(rawProjects ?? '[]') as Array<Record<string, unknown>>;
  const baseProject = storedProjects.find((project) => project.name === createdName) ?? storedProjects[0];
  const payload = {
    version: 1,
    project: {
      ...baseProject,
      sourceAssets: {
        ...(baseProject.sourceAssets as Record<string, unknown>),
        images: {
          eosin: buildImageEntry(eosinPath, 'eosin', 64, 64),
          he: buildImageEntry(hePath, 'he', 64, 16),
        },
      },
      chipConfig: {
        ...(baseProject.chipConfig as Record<string, unknown>),
        projectedSpots: 'broken-projected-spots',
      },
    },
  };

  await page.goto('/preprocess');
  await expect(page.getByRole('button', { name: 'Open workspace' })).toHaveCount(1);
  const beforeCount = await page.getByRole('button', { name: 'Open workspace' }).count();
  const beforeStoredIds = await page.evaluate(() => {
    const raw = window.localStorage.getItem('spatial-preprocess-projects');
    return JSON.parse(raw ?? '[]').map((project: { id?: string }) => project.id ?? '');
  });

  await page.getByTestId('preprocess-import-project').click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'nested-broken-preprocess.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload)),
  });

  const afterStoredIds = await page.evaluate(() => {
    const raw = window.localStorage.getItem('spatial-preprocess-projects');
    return JSON.parse(raw ?? '[]').map((project: { id?: string }) => project.id ?? '');
  });

  await expect(page).toHaveURL('/preprocess');
  await expect(page.getByTestId('preprocess-project-list')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open workspace' })).toHaveCount(beforeCount);
  expect(afterStoredIds).toEqual(beforeStoredIds);
});
