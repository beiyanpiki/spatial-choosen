import path from 'node:path';
import { expect, test } from '@playwright/test';

let projectNameSeed = 0;

const uniqueProjectName = (base: string) => {
  projectNameSeed += 1;
  return `${base}-${Date.now()}-${projectNameSeed}`;
};

const uploadFileWithButton = async (
  page: import('@playwright/test').Page,
  buttonName: RegExp,
  filePath: string,
) => {
  const uploadButton = page.getByRole('button', { name: buttonName });
  const uploadContainer = uploadButton.locator('xpath=ancestor::*[.//input[@type="file"]][1]');

  await uploadButton.click();
  await uploadContainer.locator('input[type="file"]').first().setInputFiles(filePath);
};

const setupLocalizationProject = async (page: import('@playwright/test').Page, projectName: string) => {
  const eosinPath = path.join(process.cwd(), 'tests/fixtures/preprocess/eosin.png');
  const hePath = path.join(process.cwd(), 'tests/fixtures/preprocess/he.png');

  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill(projectName);
  await page.getByTestId('preprocess-create-project').click();
  await expect(page).toHaveURL(/preprocess_id=/);

  await page.getByTestId('preprocess-step-source-assets').click();
  await uploadFileWithButton(page, /Upload eosin image/i, eosinPath);
  await uploadFileWithButton(page, /Upload H&E image/i, hePath);

  await expect(page.getByTestId('preprocess-step-localize')).toBeEnabled();
  await page.getByTestId('preprocess-step-localize').click();
  await expect(page.getByRole('button', { name: /Upload eosin image/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Replace eosin image/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Upload H&E image/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Replace H&E image/i })).toHaveCount(0);
};

test('localize workspace uses two-column shell with widget-only controls', async ({ page }) => {
  await setupLocalizationProject(page, uniqueProjectName('task14-localize-widget-only-shell'));

  const workflowRail = page.getByTestId('preprocess-workflow-rail');
  const canvasColumn = page.getByTestId('preprocess-localization-canvas-column');
  const stageSurface = page.getByTestId('localize-canvas-surface');
  const stageControls = page.getByTestId('localize-stage-controls');
  const propertiesRail = page.getByTestId('preprocess-localization-properties-rail');

  await expect(workflowRail).toBeVisible();
  await expect(canvasColumn).toBeVisible();
  await expect(stageSurface).toBeVisible();
  await expect(stageControls).toBeVisible();
  await expect(propertiesRail).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Properties' })).toHaveCount(0);
});

test('localize floating widget exposes zoom, rotation, flip, and reset sections', async ({ page }) => {
  await setupLocalizationProject(page, uniqueProjectName('task14-localize-widget-sections'));

  await expect(page.getByTestId('localize-stage-section-zoom')).toBeVisible();
  await expect(page.getByTestId('localize-stage-section-rotation')).toBeVisible();
  await expect(page.getByTestId('localize-stage-section-flip')).toBeVisible();
  await expect(page.getByTestId('localize-stage-section-reset')).toBeVisible();

  await expect(page.getByTestId('localize-stage-rotate-left-90')).toBeVisible();
  await expect(page.getByTestId('localize-stage-rotate-right-90')).toBeVisible();
  await expect(page.getByTestId('localize-stage-rotate-left-1')).toBeVisible();
  await expect(page.getByTestId('localize-stage-rotate-right-1')).toBeVisible();
  await expect(page.getByTestId('localize-stage-flip-horizontal')).toBeVisible();
  await expect(page.getByTestId('localize-stage-flip-vertical')).toBeVisible();
  await expect(page.getByTestId('localize-stage-reset')).toBeVisible();
});

test('localize floating widget reset restores the default transform', async ({ page }) => {
  await setupLocalizationProject(page, uniqueProjectName('task14-localize-widget-reset'));

  const rotationValue = page.getByTestId('localize-stage-rotation-value');
  const scaleValue = page.getByTestId('localize-stage-scale-value');

  await page.getByTestId('localize-stage-zoom-in').click();
  await page.getByTestId('localize-stage-rotate-right-90').click();
  await page.getByTestId('localize-stage-rotate-right-1').click();
  await page.getByTestId('localize-stage-flip-horizontal').click();
  await page.getByTestId('localize-stage-flip-vertical').click();

  await expect(scaleValue).not.toHaveText('100%');
  await expect(rotationValue).not.toHaveText('0.0°');

  await page.getByTestId('localize-stage-reset').click();

  await expect(scaleValue).toHaveText('100%');
  await expect(rotationValue).toHaveText('0.0°');
});
