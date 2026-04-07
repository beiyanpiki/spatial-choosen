# Preprocess Localization Floating Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the localization Properties rail and make the canvas floating widget the only control surface for zoom, rotation, flip, and reset on `/preprocess`.

**Architecture:** Keep the change inside the preprocess localization UI layer. `PreprocessWorkspace.tsx` should stop rendering `LocalizationPanel` and should pass the existing transform callbacks directly into `CanvasStage.tsx`, while `CanvasStage.tsx` grows from a zoom/rotation widget into the full floating control surface. Lock the behavior with the existing Playwright localization spec before deleting the now-unused panel file.

**Tech Stack:** Next.js 16, React 19, TypeScript strict mode, Chakra UI, Playwright, ESLint, TypeScript language server.

---

## File map

- Modify: `src/app/preprocess/components/PreprocessWorkspace.tsx`
- Modify: `src/app/preprocess/components/CanvasStage.tsx`
- Modify: `tests/e2e/preprocess-localize-panel.spec.ts`
- Delete: `src/app/preprocess/components/LocalizationPanel.tsx`

## Implementation notes before starting

- Work in a dedicated worktree because the repository already has design-doc and visual-companion artifacts in the main workspace.
- Do not change `project.localization.imageTransform`, `DEFAULT_LOCALIZATION_IMAGE_TRANSFORM`, or any transform math helpers in `src/lib/preprocess/*`.
- Keep `data-testid='preprocess-localization-canvas-column'`, `data-testid='localize-canvas-surface'`, `data-testid='localize-stage-controls'`, `data-testid='localize-stage-scale-value'`, and `data-testid='localize-stage-rotation-value'` intact so the updated test suite can still anchor on the existing canvas surface and widget.
- Add new stable selectors for the new floating-widget sections and buttons instead of relying on visible text alone.
- The approved reset behavior is exactly `rotationDegrees: 0`, `flipHorizontal: false`, `flipVertical: false`, `scale: 1`.

### Task 1: Rewrite the localization Playwright spec to describe the new widget-only UI

**Files:**
- Modify: `tests/e2e/preprocess-localize-panel.spec.ts`

- [ ] **Step 1: Replace the panel-oriented assertions with the new failing widget-only contract**

Edit the existing spec so it stops expecting the right-side rail and instead defines the approved two-column shell and floating-widget behavior.

```ts
test('localize workspace uses two-column shell with widget-only controls', async ({ page }) => {
  await setupLocalizationProject(page, 'task14-localize-widget-only-shell');

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
  await setupLocalizationProject(page, 'task14-localize-widget-sections');

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
  await setupLocalizationProject(page, 'task14-localize-widget-reset');

  const rotationValue = page.getByTestId('localize-stage-rotation-value');
  const scaleValue = page.getByTestId('localize-stage-scale-value');

  await page.getByTestId('localize-stage-zoom-in').click();
  await page.getByTestId('localize-stage-rotate-right-90').click();
  await page.getByTestId('localize-stage-rotate-right-1').click();
  await page.getByTestId('localize-stage-flip-horizontal').click();
  await page.getByTestId('localize-stage-flip-vertical').click();

  await expect(scaleValue).toHaveText('101%');
  await expect(rotationValue).toHaveText('91.0°');

  await page.getByTestId('localize-stage-reset').click();

  await expect(scaleValue).toHaveText('100%');
  await expect(rotationValue).toHaveText('0.0°');
});
```

- [ ] **Step 2: Remove assertions that belong to the deleted Properties rail**

Delete the current panel-only checks so the spec no longer requires `Image details`, `Chip box`, `Precise transform`, `Canvas controls`, or the numeric inputs.

```ts
// Delete these panel-specific selectors and expectations:
const rotationInput = page.getByTestId('localize-rotation-input');
const scaleInput = page.getByTestId('localize-scale-input');
const rotateFineMinus = page.getByTestId('localize-rotate-fine-minus');
const rotateFinePlus = page.getByTestId('localize-rotate-fine-plus');
const flipHorizontal = page.getByTestId('localize-flip-horizontal');
const flipVertical = page.getByTestId('localize-flip-vertical');
const resetTransform = page.getByTestId('localize-reset-transform');

await expect(page.getByRole('heading', { name: 'Image details' })).toBeVisible();
await expect(page.getByRole('heading', { name: 'Precise transform' })).toBeVisible();
await rotationInput.fill('15.5');
await scaleInput.fill('125');
```

- [ ] **Step 3: Run the targeted Playwright spec and verify it fails for the right reason**

Run:

```bash
npx playwright test tests/e2e/preprocess-localize-panel.spec.ts
```

Expected: FAIL because the current app still renders `preprocess-localization-properties-rail`, does not expose the new floating-widget sections/test IDs, and does not yet provide reset through the top-right widget.

### Task 2: Remove the Properties rail and route every approved control through the floating widget

**Files:**
- Modify: `src/app/preprocess/components/PreprocessWorkspace.tsx`
- Modify: `src/app/preprocess/components/CanvasStage.tsx`

- [ ] **Step 1: Stop rendering `LocalizationPanel` and collapse the localization layout to workflow rail + canvas**

In `PreprocessWorkspace.tsx`, remove the `LocalizationPanel` import and replace the current localization-step `Flex` body with a single `CanvasStage` block.

```tsx
import { AlignmentPanel } from './AlignmentPanel';
import { CanvasStage } from './CanvasStage';
import { ChipConfigPanel } from './ChipConfigPanel';
import { CropQcPanel } from './CropQcPanel';
import { ExportPanel } from './ExportPanel';
import { PREPROCESS_STEP_ITEMS, StepSidebar } from './StepSidebar';
import { TissueSelectionPanel } from './TissueSelectionPanel';

// ...inside the localization branch
<CanvasStage
  boxColor={project.localization.boxColor as LocalizationBoxColor}
  chipBounds={project.localization.chipBounds}
  image={localizationImage}
  imageTransform={project.localization.imageTransform}
  onScaleChange={(value) => {
    applyLocalizationUpdate(
      (current) => ({
        ...current,
        imageTransform: {
          ...current.imageTransform,
          scale: value,
        },
      }),
      { invalidateDownstream: false },
    );
  }}
  onScaleDelta={(delta) => {
    applyLocalizationUpdate(
      (current) => ({
        ...current,
        imageTransform: {
          ...current.imageTransform,
          scale: current.imageTransform.scale + delta,
        },
      }),
      { invalidateDownstream: false },
    );
  }}
  onRotationChange={handleLocalizationRotationChange}
  onRotationDelta={(delta) => {
    applyLocalizationUpdate((current) => ({
      ...current,
      imageTransform: {
        ...current.imageTransform,
        rotationDegrees: current.imageTransform.rotationDegrees + delta,
      },
    }));
  }}
  onFlipHorizontal={() => {
    applyLocalizationUpdate((current) => ({
      ...current,
      imageTransform: {
        ...current.imageTransform,
        flipHorizontal: !current.imageTransform.flipHorizontal,
      },
    }));
  }}
  onFlipVertical={() => {
    applyLocalizationUpdate((current) => ({
      ...current,
      imageTransform: {
        ...current.imageTransform,
        flipVertical: !current.imageTransform.flipVertical,
      },
    }));
  }}
  onResetTransform={() => {
    applyLocalizationUpdate((current) => ({
      ...current,
      imageTransform: DEFAULT_LOCALIZATION_IMAGE_TRANSFORM,
    }));
  }}
  onChipBoundsChange={(chipBounds) => {
    applyLocalizationUpdate((current) => ({
      ...current,
      chipBounds,
      method: 'manual',
    }));
  }}
/>
```

- [ ] **Step 2: Extend `CanvasStageProps` so the floating widget can own flip and reset actions**

Add the missing callbacks to the stage props and function signature.

```tsx
type CanvasStageProps = {
  boxColor: LocalizationBoxColor;
  chipBounds: PreprocessRect | null;
  image: PreprocessSourceImage | null;
  imageTransform: LocalizationImageTransform;
  onChipBoundsChange: (chipBounds: PreprocessRect) => void;
  onRotationChange: (rotationDegrees: number) => void;
  onRotationDelta: (delta: number) => void;
  onScaleChange: (scale: number) => void;
  onScaleDelta: (delta: number) => void;
  onFlipHorizontal: () => void;
  onFlipVertical: () => void;
  onResetTransform: () => void;
};

export function CanvasStage({
  boxColor,
  chipBounds,
  image,
  imageTransform,
  onChipBoundsChange,
  onRotationChange,
  onRotationDelta,
  onScaleChange,
  onScaleDelta,
  onFlipHorizontal,
  onFlipVertical,
  onResetTransform,
}: CanvasStageProps) {
```

- [ ] **Step 3: Replace the current two-section widget with the approved four-section floating control surface**

Rewrite the `localize-stage-controls` block in `CanvasStage.tsx` so it exposes separate `Zoom`, `Rotation`, `Flip`, and `Reset` sections with compact stable test IDs.

```tsx
<Box
  position='absolute'
  top={4}
  right={4}
  bg='blackAlpha.700'
  color='whiteAlpha.950'
  border='1px solid'
  borderColor='whiteAlpha.300'
  borderRadius='xl'
  px={3}
  py={3}
  backdropFilter='blur(12px)'
  data-testid='localize-stage-controls'
>
  <Stack spacing={3}>
    <Stack spacing={2} data-testid='localize-stage-section-zoom'>
      <Flex justify='space-between' align='center' gap={3}>
        <Text fontSize='xs' textTransform='uppercase' letterSpacing='0.12em' color='whiteAlpha.700'>Zoom</Text>
        <Text fontSize='sm' fontWeight='semibold' data-testid='localize-stage-scale-value'>
          {(imageTransform.scale * 100).toFixed(0)}%
        </Text>
      </Flex>
      <ButtonGroup size='sm' isAttached variant='outline'>
        <Button data-testid='localize-stage-zoom-out' onClick={() => onScaleDelta(-0.01)}>−</Button>
        <Button data-testid='localize-stage-zoom-in' onClick={() => onScaleDelta(0.01)}>+</Button>
      </ButtonGroup>
    </Stack>

    <Stack spacing={2} data-testid='localize-stage-section-rotation'>
      <Flex justify='space-between' align='center' gap={3}>
        <Text fontSize='xs' textTransform='uppercase' letterSpacing='0.12em' color='whiteAlpha.700'>Rotation</Text>
        <Text fontSize='sm' fontWeight='semibold' data-testid='localize-stage-rotation-value'>
          {imageTransform.rotationDegrees.toFixed(1)}°
        </Text>
      </Flex>
      <Flex wrap='wrap' gap={2}>
        <Button size='sm' variant='outline' data-testid='localize-stage-rotate-left-90' onClick={() => onRotationDelta(-90)}>↺90</Button>
        <Button size='sm' variant='outline' data-testid='localize-stage-rotate-right-90' onClick={() => onRotationDelta(90)}>↻90</Button>
        <Button size='sm' variant='outline' data-testid='localize-stage-rotate-left-1' onClick={() => onRotationDelta(-1)}>↺1</Button>
        <Button size='sm' variant='outline' data-testid='localize-stage-rotate-right-1' onClick={() => onRotationDelta(1)}>↻1</Button>
      </Flex>
    </Stack>

    <Stack spacing={2} data-testid='localize-stage-section-flip'>
      <Text fontSize='xs' textTransform='uppercase' letterSpacing='0.12em' color='whiteAlpha.700'>Flip</Text>
      <Flex wrap='wrap' gap={2}>
        <Button size='sm' variant='outline' data-testid='localize-stage-flip-horizontal' onClick={onFlipHorizontal}>⇋</Button>
        <Button size='sm' variant='outline' data-testid='localize-stage-flip-vertical' onClick={onFlipVertical}>⇅</Button>
      </Flex>
    </Stack>

    <Stack spacing={2} data-testid='localize-stage-section-reset'>
      <Text fontSize='xs' textTransform='uppercase' letterSpacing='0.12em' color='whiteAlpha.700'>Reset</Text>
      <Button size='sm' variant='outline' data-testid='localize-stage-reset' onClick={onResetTransform}>⟲</Button>
    </Stack>
  </Stack>
</Box>
```

- [ ] **Step 4: Run the targeted Playwright spec again and verify the new UI passes**

Run:

```bash
npx playwright test tests/e2e/preprocess-localize-panel.spec.ts
```

Expected: PASS, including the new two-column shell expectation, the section/button visibility checks, and the reset-to-default transform behavior.

### Task 3: Delete the dead panel file and run final verification

**Files:**
- Delete: `src/app/preprocess/components/LocalizationPanel.tsx`
- Modify: `src/app/preprocess/components/PreprocessWorkspace.tsx`
- Modify: `src/app/preprocess/components/CanvasStage.tsx`
- Modify: `tests/e2e/preprocess-localize-panel.spec.ts`

- [ ] **Step 1: Delete the unused `LocalizationPanel` component once the workspace no longer imports it**

Remove the file entirely.

```bash
rm src/app/preprocess/components/LocalizationPanel.tsx
```

Expected repository state after deletion:

```ts
// PreprocessWorkspace.tsx no longer contains this import.
import { LocalizationPanel } from './LocalizationPanel';

// grep for LocalizationPanel should return no production usages.
```

- [ ] **Step 2: Run diagnostics on all changed preprocess files**

Run diagnostics on:

```text
src/app/preprocess/components/PreprocessWorkspace.tsx
src/app/preprocess/components/CanvasStage.tsx
tests/e2e/preprocess-localize-panel.spec.ts
```

Expected: no new TypeScript or JSX diagnostics in the changed files.

- [ ] **Step 3: Run build and capture the app-wide verification result**

Run:

```bash
npm run build
```

Expected: successful Next.js production build with no regressions from the localization UI simplification.

- [ ] **Step 4: Manually verify the localization workflow in the browser**

Run the app and confirm the approved UX end to end.

```bash
npm run dev
```

Manual QA checklist:

```text
1. Open /preprocess and create a localization-ready project.
2. Enter the Localize step.
3. Confirm there is no right-side Properties rail.
4. Confirm the top-right widget shows Zoom, Rotation, Flip, and Reset sections.
5. Click ↺90 / ↻90 and verify the rotation readout changes by 90°.
6. Click ↺1 / ↻1 and verify the rotation readout changes by 1°.
7. Click horizontal and vertical flip and verify the displayed image mirrors accordingly.
8. Change zoom, rotation, and both flips; then click Reset and verify the readouts return to 100% and 0.0° while flips return to the default visual orientation.
9. Drag, resize, and rotate the chip box handle to confirm localization geometry interactions still work.
```

- [ ] **Step 5: Commit the finished UI simplification in one focused commit**

Run:

```bash
git add src/app/preprocess/components/PreprocessWorkspace.tsx \
  src/app/preprocess/components/CanvasStage.tsx \
  tests/e2e/preprocess-localize-panel.spec.ts \
  docs/superpowers/specs/2026-04-07-preprocess-localization-floating-controls-design.md \
  docs/superpowers/plans/2026-04-07-preprocess-localization-floating-controls.md
git commit -m "feat: simplify preprocess localization controls"
```

Expected: one commit containing the widget-only localization UI change plus its approved spec/plan docs.

## Self-review checklist

- Spec coverage check:
  - Remove Properties rail → Task 2, Step 1
  - Widget-only Zoom/Rotation/Flip/Reset sections → Task 2, Step 3
  - `↺90`, `↻90`, `↺1`, `↻1` controls → Task 1, Step 1 and Task 2, Step 3
  - Reset to default transform → Task 1, Step 1 and Task 2, Step 3
  - Preserve localization geometry/state behavior → Task 2, Step 1 and Task 3, Step 4
- Placeholder scan:
  - No `TBD`, `TODO`, or “similar to above” placeholders remain.
- Type consistency:
  - New stage prop names must match exactly across `PreprocessWorkspace.tsx` and `CanvasStage.tsx`: `onFlipHorizontal`, `onFlipVertical`, `onResetTransform`, `localize-stage-rotate-left-90`, `localize-stage-rotate-right-90`, `localize-stage-rotate-left-1`, `localize-stage-rotate-right-1`, `localize-stage-flip-horizontal`, `localize-stage-flip-vertical`, `localize-stage-reset`.
