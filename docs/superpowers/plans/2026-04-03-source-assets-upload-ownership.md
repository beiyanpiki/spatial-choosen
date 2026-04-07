# Source Assets Upload Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move both Eosin and H&E upload ownership into the `Source Assets` preprocess step so `Localize` and `Align` consume existing project images but no longer expose their own upload controls.

**Architecture:** Keep the storage model unchanged by continuing to use `project.sourceAssets.images` plus the existing `handleUploadEosin(...)` and `handleUploadHe(...)` callbacks in `PreprocessWorkspace.tsx`. Implement a focused source-assets intake UI, remove upload controls from downstream panels, and cover the behavior with targeted Playwright tests plus diagnostics, build, and manual QA.

**Tech Stack:** Next.js 16, React 19, TypeScript strict mode, Chakra UI, Playwright, TypeScript language server.

---

## File map

- Modify: `src/app/preprocess/components/PreprocessWorkspace.tsx`
- Modify or create: `src/app/preprocess/components/SourceAssetsPanel.tsx`
- Modify: `src/app/preprocess/components/LocalizationPanel.tsx`
- Modify: `src/app/preprocess/components/AlignmentPanel.tsx`
- Modify: `tests/e2e/preprocess-upload-support.spec.ts`
- Modify: `tests/e2e/preprocess-localize-panel.spec.ts`
- Modify: `tests/e2e/preprocess-alignment-transform.spec.ts`

## Implementation notes before starting

- Work in a dedicated worktree because the repo already contains other changes.
- Keep using `buildSourceImage(...)`, `invalidateOnSourceAssetsChange(...)`, and existing project slices. This task changes ownership and UI flow, not persisted data shape.
- Do not keep downstream upload shortcuts. The approved design is strict ownership by `Source Assets` only.
- `handleUploadEosin(...)` currently forces `currentStep: "localization"`; remove that jump so users remain in `Source Assets` after upload.
- Keep `Localize` and `Align` fully functional once required images are present.

### Task 1: Lock the new upload ownership contract with failing Playwright coverage

**Files:**
- Modify: `tests/e2e/preprocess-upload-support.spec.ts`
- Modify: `tests/e2e/preprocess-localize-panel.spec.ts`
- Modify: `tests/e2e/preprocess-alignment-transform.spec.ts`

- [ ] **Step 1: Update the source-assets Playwright spec to assert both uploads live in Source Assets**

Add or rewrite a test in `tests/e2e/preprocess-upload-support.spec.ts` so the contract is explicit:

```ts
test('source assets owns eosin and h&e uploads', async ({ page }) => {
  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill('task-source-assets-ownership');
  await page.getByTestId('preprocess-create-project').click();
  await expect(page).toHaveURL(/preprocess_id=/);

  await expect(page.getByRole('heading', { name: 'Source image intake' })).toBeVisible();
  await expect(page.getByRole('button', { name: /upload eosin image/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /upload h&e image/i })).toBeVisible();
});
```

- [ ] **Step 2: Update the localization spec so it expects no upload UI in Localize**

In `tests/e2e/preprocess-localize-panel.spec.ts`, replace the setup path that uploads from `Localize` with a setup helper that uploads from `Source Assets`, then assert the localization rail has no upload button:

```ts
await expect(page.getByRole('button', { name: /upload eosin image/i })).toHaveCount(0);
await expect(page.getByRole('button', { name: /replace eosin image/i })).toHaveCount(0);
```

- [ ] **Step 3: Update the alignment spec so it expects no upload UI in Align**

In `tests/e2e/preprocess-alignment-transform.spec.ts`, upload both assets from `Source Assets`, enter `Align`, and assert the old H&E upload path is gone:

```ts
await expect(page.getByRole('button', { name: /upload h&e image/i })).toHaveCount(0);
await expect(page.getByText('Alignment needs both source images')).toHaveCount(0);
```

- [ ] **Step 4: Run the targeted tests to verify they fail against the current UI**

Run: `npx playwright test tests/e2e/preprocess-upload-support.spec.ts tests/e2e/preprocess-localize-panel.spec.ts tests/e2e/preprocess-alignment-transform.spec.ts`

Expected: FAIL because uploads still originate from `Localize`/`Align`, and the new Source Assets contract is not implemented yet.

### Task 2: Implement the Source Assets intake panel and keep upload state centralized

**Files:**
- Modify: `src/app/preprocess/components/PreprocessWorkspace.tsx`
- Modify or create: `src/app/preprocess/components/SourceAssetsPanel.tsx`

- [ ] **Step 1: Add a focused Source Assets intake UI**

Render a real source-assets panel instead of the current placeholder shell. Whether inline or extracted, the UI should expose two cards with status, filename, dimensions, and upload/replace buttons:

```tsx
<Stack spacing={4}>
  <Heading size='md'>Source image intake</Heading>
  <SourceAssetCard
    title='Eosin image'
    image={project.sourceAssets.images.eosin}
    buttonLabel={project.sourceAssets.images.eosin ? 'Replace eosin image' : 'Upload eosin image'}
    onUpload={handleUploadEosin}
  />
  <SourceAssetCard
    title='H&E image'
    image={project.sourceAssets.images.he}
    buttonLabel={project.sourceAssets.images.he ? 'Replace H&E image' : 'Upload H&E image'}
    onUpload={handleUploadHe}
  />
</Stack>
```

- [ ] **Step 2: Remove the automatic step jump from Eosin upload**

In `handleUploadEosin(...)`, keep localization defaults and invalidation, but stop overwriting `currentStep` to `"localization"`:

```ts
const invalidatedProject = invalidateOnSourceAssetsChange({
  ...current,
  sourceAssets: nextSourceAssets,
  localization: nextLocalization,
});

return {
  ...invalidatedProject,
  localization: nextLocalization,
};
```

- [ ] **Step 3: Update Source Assets step copy to match the new ownership model**

Replace the current shell copy in `placeholderCopyByStep.sourceAssets` with real intake guidance:

```ts
sourceAssets: {
  title: 'Source image intake',
  body: 'Upload or replace the Eosin and H&E images here before continuing into localization and alignment.',
},
```

- [ ] **Step 4: Run diagnostics on the workspace and new source-assets UI**

Run: `lsp_diagnostics` on `src/app/preprocess/components/PreprocessWorkspace.tsx`

Run: `lsp_diagnostics` on `src/app/preprocess/components/SourceAssetsPanel.tsx` if extracted

Expected: no TypeScript or JSX errors after adding the source-intake UI and changing upload flow ownership.

### Task 3: Remove downstream upload controls and replace them with consumer-only states

**Files:**
- Modify: `src/app/preprocess/components/LocalizationPanel.tsx`
- Modify: `src/app/preprocess/components/AlignmentPanel.tsx`

- [ ] **Step 1: Remove Eosin upload controls from LocalizationPanel**

Delete the file input, upload button, and `onUploadEosin` prop so the image-details card becomes status-only:

```tsx
<Text fontSize='sm' color='gray.500'>
  This step uses the Eosin image already loaded in Source Assets.
</Text>
<Text fontSize='sm' color='gray.600'>
  {image ? `${image.fileName} • ${image.width ?? '?'}×${image.height ?? '?'} px` : 'Return to Source Assets to load the Eosin image.'}
</Text>
```

- [ ] **Step 2: Remove H&E upload controls from AlignmentPanel**

Delete `onUploadMovingImage`, the hidden file input, and the conditional upload button. Keep the missing-images box, but change its recovery guidance:

```tsx
<Box border='1px solid' borderColor='orange.200' borderRadius='lg' p={5} bg='orange.50'>
  <Stack spacing={2}>
    <Heading size='sm'>Alignment needs both source images</Heading>
    <Text color='orange.800' fontSize='sm'>
      Return to Source Assets to load the Eosin and H&E inputs before solving alignment.
    </Text>
  </Stack>
</Box>
```

- [ ] **Step 3: Update PreprocessWorkspace wiring to match the new props**

Remove the old downstream upload props when rendering the localization and alignment panels:

```tsx
<LocalizationPanel
  boxColor={...}
  image={localizationImage}
  imageTransform={project.localization.imageTransform}
  onBoxColorChange={...}
  onFlipHorizontal={...}
  onFlipVertical={...}
  onResetTransform={...}
  onRotationChange={...}
  onRotationDelta={...}
  onScaleChange={...}
  onScaleDelta={...}
/>

<AlignmentPanel
  alignment={project.alignment}
  chipBounds={project.localization.chipBounds}
  movingImage={alignmentMovingImage}
  referenceImage={alignmentReferenceImage}
  onAlignmentChange={applyAlignmentUpdate}
/>
```

- [ ] **Step 4: Run diagnostics on the downstream panels and workspace**

Run: `lsp_diagnostics` on `src/app/preprocess/components/LocalizationPanel.tsx`

Run: `lsp_diagnostics` on `src/app/preprocess/components/AlignmentPanel.tsx`

Run: `lsp_diagnostics` on `src/app/preprocess/components/PreprocessWorkspace.tsx`

Expected: no type errors after removing the downstream upload props and controls.

### Task 4: Verify the full behavior end-to-end

**Files:**
- Modify: `tests/e2e/preprocess-upload-support.spec.ts`
- Modify: `tests/e2e/preprocess-localize-panel.spec.ts`
- Modify: `tests/e2e/preprocess-alignment-transform.spec.ts`

- [ ] **Step 1: Run the targeted Playwright specs and verify they pass**

Run: `npx playwright test tests/e2e/preprocess-upload-support.spec.ts tests/e2e/preprocess-localize-panel.spec.ts tests/e2e/preprocess-alignment-transform.spec.ts`

Expected: PASS; Source Assets owns both uploads, Localize has no upload controls, and Align has no upload controls.

- [ ] **Step 2: Run final diagnostics over every changed component file**

Run: `lsp_diagnostics` on:

```text
src/app/preprocess/components/PreprocessWorkspace.tsx
src/app/preprocess/components/SourceAssetsPanel.tsx (if created)
src/app/preprocess/components/LocalizationPanel.tsx
src/app/preprocess/components/AlignmentPanel.tsx
```

Expected: no errors.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: Next.js build succeeds.

- [ ] **Step 4: Perform manual QA in the browser**

Verify this exact flow on `/preprocess`:

```text
1. Create a new preprocess project.
2. Stay on Source Assets.
3. Upload Eosin from Source Assets and confirm the UI does not auto-jump to Localize.
4. Upload H&E from Source Assets.
5. Enter Localize and confirm there is no Eosin upload/replace button; the canvas still works.
6. Enter Align and confirm there is no H&E upload button; landmark UI still renders when both images are present.
7. Create another project with missing assets and confirm Localize/Align show guidance pointing back to Source Assets.
```

- [ ] **Step 5: Commit**

Run only if the human explicitly asks for a commit:

```bash
git add src/app/preprocess/components/PreprocessWorkspace.tsx \
  src/app/preprocess/components/SourceAssetsPanel.tsx \
  src/app/preprocess/components/LocalizationPanel.tsx \
  src/app/preprocess/components/AlignmentPanel.tsx \
  tests/e2e/preprocess-upload-support.spec.ts \
  tests/e2e/preprocess-localize-panel.spec.ts \
  tests/e2e/preprocess-alignment-transform.spec.ts
git commit -m "feat: centralize preprocess source image uploads"
```

Expected: commit created only on explicit request.
