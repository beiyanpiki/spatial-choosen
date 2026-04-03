import path from 'node:path';
import { expect, test } from '@playwright/test';

type ChipBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

async function createProject(page: import('@playwright/test').Page, name: string) {
  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill(name);
  await page.getByTestId('preprocess-create-project').click();
  await expect(page).toHaveURL(/preprocess_id=/);
}

async function uploadEosinForLocalization(page: import('@playwright/test').Page) {
  const eosinPath = path.join(process.cwd(), 'tests/fixtures/preprocess/eosin.png');
  await page.getByTestId('preprocess-step-localize').click();
  await page.getByRole('button', { name: /Upload eosin image/i }).click();
  await page.locator('input[type="file"]').first().setInputFiles(eosinPath);
  await expect(page.getByText('No eosin image loaded')).toBeHidden();
}

async function readPersistedLocalizationChipBounds(page: import('@playwright/test').Page): Promise<ChipBounds> {
  const preprocessId = new URL(page.url()).searchParams.get('preprocess_id');
  if (!preprocessId) {
    throw new Error('Missing preprocess_id in URL');
  }

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const chipBounds = await page.evaluate((id) => {
      const raw = window.localStorage.getItem('spatial-preprocess-projects');
      if (!raw) {
        return null;
      }

      const projects = JSON.parse(raw) as Array<Record<string, unknown>>;
      const project = projects.find((entry) => entry.id === id);
      if (!project) {
        return null;
      }

      const localization = project.localization as { chipBounds?: ChipBounds | null } | undefined;
      return localization?.chipBounds ?? null;
    }, preprocessId);

    if (chipBounds) {
      return chipBounds;
    }

    await page.waitForTimeout(100);
  }

  throw new Error('Expected chipBounds in persisted localization state');
}

async function readPersistedLocalizationRotation(page: import('@playwright/test').Page): Promise<number> {
  const preprocessId = new URL(page.url()).searchParams.get('preprocess_id');
  if (!preprocessId) {
    throw new Error('Missing preprocess_id in URL');
  }

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const rotation = await page.evaluate((id) => {
      const raw = window.localStorage.getItem('spatial-preprocess-projects');
      if (!raw) {
        return null;
      }

      const projects = JSON.parse(raw) as Array<Record<string, unknown>>;
      const project = projects.find((entry) => entry.id === id);
      if (!project) {
        return null;
      }

      const localization = project.localization as
        | {
            rotation?: number;
            rotationDeg?: number;
            rotationDegrees?: number;
            imageTransform?: {
              rotation?: number;
              rotationDeg?: number;
              rotationDegrees?: number;
            };
          }
        | undefined;

      const candidate = [
        localization?.imageTransform?.rotationDegrees,
        localization?.imageTransform?.rotationDeg,
        localization?.imageTransform?.rotation,
        localization?.rotation,
        localization?.rotationDeg,
        localization?.rotationDegrees,
      ].find(
        (value): value is number => typeof value === 'number',
      );

      return candidate ?? null;
    }, preprocessId);

    if (typeof rotation === 'number') {
      return rotation;
    }

    await page.waitForTimeout(100);
  }

  throw new Error('Expected rotation in persisted localization state');
}

function expectBoundsInsideImage(bounds: ChipBounds) {
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(1);
}

async function dragHandle(
  page: import('@playwright/test').Page,
  testId: string,
  delta: { x: number; y: number },
) {
  const handle = page.getByTestId(testId);
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (!box) {
    throw new Error(`Missing bounding box for ${testId}`);
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + delta.x, startY + delta.y, { steps: 8 });
  await page.mouse.up();
}

test('localize mutations do not revoke the active source image URL', async ({ page }) => {
  await createProject(page, `localize-objecturl-${Date.now()}`);
  await uploadEosinForLocalization(page);

  await page.getByTestId('localize-flip-horizontal').click();

  await page.getByTestId('preprocess-step-align').click();
  await expect(page.getByText('No eosin image loaded')).toBeHidden();
  await expect(page.getByText('Eosin: eosin.png')).toBeVisible();
  const consoleMessages = await page.consoleMessages();
  expect(consoleMessages.filter((message) => message.type() === 'error').map((message) => message.text())).not.toContain(
    expect.stringContaining('ERR_FILE_NOT_FOUND'),
  );
});

test('localize canvas wheel updates zoom scale', async ({ page }) => {
  await createProject(page, `localize-wheel-zoom-${Date.now()}`);
  await uploadEosinForLocalization(page);

  const slider = page.getByTestId('localize-scale-slider');
  await expect(slider).toBeVisible();
  const before = Number(await slider.inputValue());
  const beforeScroll = await page.evaluate(() => window.scrollY);

  const overlay = page.getByRole('img', { name: 'Chip localization overlay' });
  const overlayBox = await overlay.boundingBox();
  if (!overlayBox) throw new Error('Missing localize overlay bounds');
  await page.mouse.move(overlayBox.x + overlayBox.width * 0.55, overlayBox.y + overlayBox.height * 0.55);
  await page.mouse.wheel(0, 600);

  await expect.poll(async () => Number(await slider.inputValue())).toBeCloseTo(before - 0.01, 5);
  await expect(page.evaluate(() => window.scrollY)).resolves.toBe(beforeScroll);
});

test('localize canvas supports edge and corner resize while preserving square bounds inside image', async ({ page }) => {
  await createProject(page, `localize-edge-corner-resize-${Date.now()}`);
  await uploadEosinForLocalization(page);

  await page.getByTestId('preprocess-step-align').click();
  const initial = await readPersistedLocalizationChipBounds(page);
  const baselineRatio = initial.width / initial.height;

  await page.getByTestId('preprocess-step-localize').click();

  await dragHandle(page, 'localize-box-handle-e', { x: 100, y: 0 });
  await page.getByTestId('preprocess-step-align').click();
  const afterEdgeDrag = await readPersistedLocalizationChipBounds(page);
  expect(afterEdgeDrag.width).toBeGreaterThan(initial.width);
  expect(afterEdgeDrag.width / afterEdgeDrag.height).toBeCloseTo(baselineRatio, 2);
  expectBoundsInsideImage(afterEdgeDrag);

  await page.getByTestId('preprocess-step-localize').click();
  await dragHandle(page, 'localize-box-handle-nw', { x: 220, y: 220 });
  await page.getByTestId('preprocess-step-align').click();
  const afterCornerDrag = await readPersistedLocalizationChipBounds(page);
  expect(afterCornerDrag.width).toBeLessThan(afterEdgeDrag.width);
  expect(afterCornerDrag.width / afterCornerDrag.height).toBeCloseTo(baselineRatio, 2);
  expectBoundsInsideImage(afterCornerDrag);

  await page.getByTestId('preprocess-step-localize').click();
  await expect(page.getByText('LL', { exact: true })).toBeVisible();
});

test('localize canvas exposes a visible rotation handle that changes persisted rotation', async ({ page }) => {
  await createProject(page, `localize-rotation-handle-${Date.now()}`);
  await uploadEosinForLocalization(page);

  await page.getByTestId('preprocess-step-align').click();
  const beforeBounds = await readPersistedLocalizationChipBounds(page);
  const beforeRotation = await readPersistedLocalizationRotation(page);
  await page.getByTestId('preprocess-step-localize').click();

  const handle = page.getByTestId('localize-rotation-handle-visible');
  await expect(handle).toBeVisible();
  const handleBox = await handle.boundingBox();
  if (!handleBox) {
    throw new Error('Missing bounding box for localize-rotation-handle-visible');
  }

  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 60, startY + 80, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => Number(await page.getByTestId('localize-rotation-slider').inputValue())).not.toBe(beforeRotation);

  await page.getByTestId('preprocess-step-align').click();
  await expect.poll(async () => readPersistedLocalizationRotation(page)).not.toBe(beforeRotation);
  const afterBounds = await readPersistedLocalizationChipBounds(page);
  expect(afterBounds.x).toBeCloseTo(beforeBounds.x, 4);
  expect(afterBounds.y).toBeCloseTo(beforeBounds.y, 4);
  expect(afterBounds.width).toBeCloseTo(beforeBounds.width, 4);
  expect(afterBounds.height).toBeCloseTo(beforeBounds.height, 4);
});
