import path from 'node:path';
import { expect, test } from '@playwright/test';

const uploadFileWithButton = async (
  page: import('@playwright/test').Page,
  buttonName: RegExp,
  filePath: string,
) => {
  const uploadButton = page.getByRole('button', { name: buttonName });
  await uploadButton.click();
  await uploadButton.locator('xpath=following-sibling::input[@type="file"][1]').setInputFiles(filePath);
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

test('localize workspace uses three-column shell with floating stage controls', async ({ page }) => {
  await setupLocalizationProject(page, 'task13-localize-three-column-shell');

  const workflowRail = page.getByTestId('preprocess-workflow-rail');
  const canvasColumn = page.getByTestId('preprocess-localization-canvas-column');
  const propertiesRail = page.getByTestId('preprocess-localization-properties-rail');
  const stageSurface = page.getByTestId('localize-canvas-surface');
  const stageControls = page.getByTestId('localize-stage-controls');

  await expect(workflowRail).toBeVisible();
  await expect(canvasColumn).toBeVisible();
  await expect(propertiesRail).toBeVisible();
  await expect(stageSurface).toBeVisible();
  await expect(stageControls).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Workflow' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Localization canvas' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Properties' })).toBeVisible();

  const workflowBox = await workflowRail.boundingBox();
  const canvasBox = await canvasColumn.boundingBox();
  const propertiesBox = await propertiesRail.boundingBox();
  const stageBox = await stageSurface.boundingBox();
  const controlsBox = await stageControls.boundingBox();

  if (!workflowBox || !canvasBox || !propertiesBox || !stageBox || !controlsBox) {
    throw new Error('Expected localization shell regions to have bounding boxes');
  }

  expect(workflowBox.x).toBeLessThan(canvasBox.x);
  expect(canvasBox.x).toBeLessThan(propertiesBox.x);
  expect(canvasBox.width).toBeGreaterThan(workflowBox.width);
  expect(canvasBox.width).toBeGreaterThan(propertiesBox.width);
  expect(stageBox.width).toBeGreaterThan(propertiesBox.width);
  expect(stageBox.height).toBeGreaterThan(520);
  expect(controlsBox.x).toBeGreaterThan(stageBox.x);
  expect(controlsBox.x + controlsBox.width).toBeLessThanOrEqual(stageBox.x + stageBox.width);
  expect(controlsBox.y + controlsBox.height).toBeLessThanOrEqual(stageBox.y + stageBox.height);
});

test('localize properties rail groups compact modules and keeps precise controls', async ({ page }) => {
  await setupLocalizationProject(page, 'task13-localize-properties-groups');

  await expect(page.getByRole('heading', { name: 'Image details' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Chip box' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Precise transform' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Canvas controls' })).toBeVisible();
  await expect(page.getByText('Wheel to zoom, drag the box edges to resize, drag the outer handle to rotate.', { exact: true })).toBeVisible();

  const rotationInput = page.getByTestId('localize-rotation-input');
  const scaleInput = page.getByTestId('localize-scale-input');
  const rotateMinusNinety = page.getByTestId('localize-rotate-minus-90');
  const rotatePlusNinety = page.getByTestId('localize-rotate-plus-90');
  const rotateFineMinus = page.getByTestId('localize-rotate-fine-minus');
  const rotateFinePlus = page.getByTestId('localize-rotate-fine-plus');
  const scaleFineMinus = page.getByTestId('localize-scale-fine-minus');
  const scaleFinePlus = page.getByTestId('localize-scale-fine-plus');
  const flipHorizontal = page.getByTestId('localize-flip-horizontal');
  const flipVertical = page.getByTestId('localize-flip-vertical');
  const resetTransform = page.getByTestId('localize-reset-transform');

  await expect(rotationInput).toBeVisible();
  await expect(scaleInput).toBeVisible();
  await expect(rotateMinusNinety).toBeVisible();
  await expect(rotatePlusNinety).toBeVisible();
  await expect(rotateFineMinus).toBeVisible();
  await expect(rotateFinePlus).toBeVisible();
  await expect(scaleFineMinus).toBeVisible();
  await expect(scaleFinePlus).toBeVisible();
  await expect(flipHorizontal).toBeVisible();
  await expect(flipVertical).toBeVisible();
  await expect(resetTransform).toBeVisible();

  await expect(rotationInput).toHaveAttribute('inputmode', 'decimal');
  await expect(scaleInput).toHaveAttribute('inputmode', 'decimal');

  await rotationInput.fill('15.5');
  await rotationInput.blur();
  await expect(page.getByTestId('localize-stage-rotation-value')).toHaveText('15.5°');

  await scaleInput.fill('125');
  await scaleInput.blur();
  await expect(page.getByTestId('localize-stage-scale-value')).toHaveText('125%');

  await rotateMinusNinety.click();
  await expect(page.getByTestId('localize-stage-rotation-value')).toHaveText('-74.5°');

  await rotateFinePlus.click();
  await expect(page.getByTestId('localize-stage-rotation-value')).toHaveText('-74.4°');

  await scaleFineMinus.click();
  await expect(page.getByTestId('localize-stage-scale-value')).toHaveText('124%');
});

test('localize stage floating controls expose direct zoom and rotation actions', async ({ page }) => {
  await setupLocalizationProject(page, 'task13-localize-stage-controls');

  const stageControls = page.getByTestId('localize-stage-controls');
  const zoomOut = page.getByTestId('localize-stage-zoom-out');
  const zoomIn = page.getByTestId('localize-stage-zoom-in');
  const rotateLeft = page.getByTestId('localize-stage-rotate-left');
  const rotateRight = page.getByTestId('localize-stage-rotate-right');
  const scaleValue = page.getByTestId('localize-stage-scale-value');
  const rotationValue = page.getByTestId('localize-stage-rotation-value');

  await expect(stageControls).toBeVisible();
  await expect(scaleValue).toHaveText('100%');
  await expect(rotationValue).toHaveText('0.0°');

  await zoomIn.click();
  await expect(scaleValue).toHaveText('101%');

  await zoomOut.click();
  await expect(scaleValue).toHaveText('100%');

  await rotateLeft.click();
  await expect(rotationValue).toHaveText('-90.0°');

  await rotateRight.click();
  await expect(rotationValue).toHaveText('0.0°');
});

test('localize box outline uses a 1px stroke', async ({ page }) => {
  await setupLocalizationProject(page, 'task13-localize-outline-width');

  await expect(page.getByTestId('localize-box-outline')).toHaveAttribute('stroke-width', '1');
});

test('localize fine adjust buttons keep updating while held', async ({ page }) => {
  await setupLocalizationProject(page, 'task13-localize-hold-repeat');

  const rotateFinePlus = page.getByTestId('localize-rotate-fine-plus');
  const scaleFinePlus = page.getByTestId('localize-scale-fine-plus');
  const rotationValue = page.getByTestId('localize-stage-rotation-value');
  const scaleValue = page.getByTestId('localize-stage-scale-value');

  await rotateFinePlus.hover();
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  expect(Number((await rotationValue.textContent())?.replace('°', '') ?? '0')).toBeGreaterThan(0.1);

  await scaleFinePlus.hover();
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  expect(Number((await scaleValue.textContent())?.replace('%', '') ?? '0')).toBeGreaterThan(101);
});

test('localize panel does not show Saved chip rectangle section', async ({ page }) => {
  await setupLocalizationProject(page, 'task13-localize-no-saved-rect');

  await expect(page.getByText('Saved chip rectangle', { exact: true })).toHaveCount(0);
});
