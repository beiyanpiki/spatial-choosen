## Topic

Preprocess source-asset ownership update: move both Eosin and H&E upload/replace entry points into the `Source Assets` step and make downstream steps consumer-only.

## Goal

Keep scope strictly limited to the preprocess upload flow:

1. Make `Source Assets` the only place where users upload or replace Eosin and H&E images.
2. Remove upload/replace actions from `Localize` and `Align`.
3. Preserve the existing project storage model, downstream invalidation, autosave, and step gating.
4. Keep `Localize` and `Align` usable as soon as the required source images already exist on the project.

## Context

- `src/app/preprocess/components/PreprocessWorkspace.tsx` already stores both source images in `project.sourceAssets.images` and already has separate `handleUploadEosin(...)` and `handleUploadHe(...)` callbacks that build source images and invalidate downstream state.
- `LocalizationPanel.tsx` currently exposes the Eosin upload/replace button even though localization consumes `project.sourceAssets.images[project.localization.targetImage]`.
- `AlignmentPanel.tsx` currently conditionally exposes H&E upload when the moving image is missing, even though alignment consumes `project.sourceAssets.images[project.alignment.movingImage]` and `project.sourceAssets.images[project.alignment.referenceImage]`.
- `placeholderCopyByStep.sourceAssets` in `PreprocessWorkspace.tsx` still describes the step as a shell rather than the real asset intake step.
- The user explicitly approved a strict ownership model: uploads belong only to `Source Assets`; `Localize` and `Align` should not keep replacement shortcuts.

## Approaches Considered

### Approach A (recommended): Single-owner upload step in `Source Assets`

- Add explicit Eosin and H&E upload cards to the `Source Assets` step.
- Reuse the existing upload handlers from `PreprocessWorkspace.tsx`.
- Remove upload UI from `LocalizationPanel.tsx` and `AlignmentPanel.tsx`.
- Downstream steps render previews and blocking guidance when required assets are missing.

**Pros**: exactly matches the approved UX, clarifies ownership, reduces duplicate entry points, and keeps storage/invalidation logic centralized.
**Cons**: requires touching multiple preprocess components instead of a one-file patch.

### Approach B: Centralize primary uploads in `Source Assets`, but keep hidden or de-emphasized replacement paths downstream

- Present `Source Assets` as the main upload step.
- Leave small replace controls in `Localize` and `Align` for convenience.

**Pros**: smaller transition cost for current behavior.
**Cons**: violates the approved strict ownership model and keeps the mental model split across multiple steps.

### Approach C: Keep current upload locations, but add mirrored upload previews to `Source Assets`

- Use `Source Assets` as a dashboard only.
- Keep actual upload controls in `Localize` and `Align`.

**Pros**: lowest implementation risk.
**Cons**: does not satisfy the requested workflow change.

## Chosen Design

Use Approach A.

### Step responsibilities

#### `Source Assets`

`Source Assets` becomes the single owner of source-image intake.

- It renders two clearly separated asset cards: one for Eosin and one for H&E.
- Each card shows asset status, file name, dimensions when available, and one upload/replace action.
- Uploading or replacing either image still uses the existing `handleUploadEosin(...)` / `handleUploadHe(...)` pathways so downstream invalidation remains unchanged.
- The step copy should stop describing itself as a shell and instead explain that both source images are managed here before localization and alignment.

#### `Localize`

`Localize` becomes a pure consumer of the already-loaded Eosin image.

- Remove the Eosin upload button and file input from `LocalizationPanel.tsx`.
- Keep the canvas, chip box controls, floating stage controls, and precise transform controls unchanged.
- If Eosin is missing, render a blocking empty state or guidance message that clearly tells the user to return to `Source Assets` to load it.
- Do not add a replacement shortcut here.

#### `Align`

`Align` becomes a pure consumer of the already-loaded images.

- Remove the H&E upload control from `AlignmentPanel.tsx`.
- Keep the landmark editing workflow unchanged when required images are present.
- If H&E is missing, or if a required source image is absent, render step-level guidance that tells the user to return to `Source Assets`.
- Do not add a replacement shortcut here.

### Data flow and state impact

This is an ownership/UI change, not a storage-model change.

1. Uploaded files continue to be normalized through `buildSourceImage(...)`.
2. Both images continue to live in `project.sourceAssets.images`.
3. Localization continues to read its display image from `project.sourceAssets.images[project.localization.targetImage]`.
4. Alignment continues to read reference and moving images from `project.sourceAssets.images[project.alignment.referenceImage]` and `project.sourceAssets.images[project.alignment.movingImage]`.
5. Existing invalidation helpers (`invalidateOnSourceAssetsChange(...)`, downstream stale-state handling, autosave updates) remain the only way source-asset changes propagate.

### Component changes

1. **`src/app/preprocess/components/PreprocessWorkspace.tsx`**
   - Replace the current `sourceAssets` placeholder shell with a real source-intake panel.
   - Keep `handleUploadEosin(...)` and `handleUploadHe(...)` as the upload entry points, but remove the current automatic step jump to `localization` so upload ownership stays anchored in `Source Assets`.
   - Update Source Assets step copy to describe the new intake role.

2. **New or extracted source-assets UI component(s)**
   - Either implement the source-intake UI inline in `PreprocessWorkspace.tsx` or extract a focused component such as `SourceAssetsPanel.tsx` if that keeps responsibilities clearer.
   - The panel should be limited to asset status, upload/replace actions, and concise guidance; it should not absorb localization or alignment controls.

3. **`src/app/preprocess/components/LocalizationPanel.tsx`**
   - Remove the file input and upload/replace button.
   - Keep compact property groups for image details, chip box, canvas controls, and precise transform.
   - Update image-details copy so it reports readiness but no longer implies uploading happens in this step.

4. **`src/app/preprocess/components/AlignmentPanel.tsx`**
   - Remove the optional `onUploadMovingImage` UI pathway.
   - Keep the alignment interaction model unchanged when images are present.
   - Add a clear missing-asset message when the required source images have not been loaded yet.

## Acceptance criteria

1. `Source Assets` shows dedicated upload/replace controls for both Eosin and H&E.
2. Uploading either image through `Source Assets` updates the project and preserves existing invalidation/autosave behavior.
3. `Localize` no longer exposes Eosin upload or replace UI.
4. `Align` no longer exposes H&E upload or replace UI.
5. `Localize` and `Align` show clear guidance when required source images are missing instead of offering their own upload controls.
6. Existing localization and alignment behavior still works unchanged once the required source images are already present.

## Risk and mitigation

- Risk: removing downstream upload buttons could strand users in `Localize` or `Align` without a clear recovery path.
  - Mitigation: add explicit, step-local guidance that points back to `Source Assets` whenever a required image is missing.
- Risk: `handleUploadEosin(...)` currently updates localization defaults and moves the current step to `localization`, which may be too aggressive once upload ownership moves earlier.
  - Mitigation: review and make that navigation behavior explicit during implementation rather than inheriting it accidentally.
- Risk: keeping the source-intake UI inline inside `PreprocessWorkspace.tsx` could make an already-large file harder to maintain.
  - Mitigation: allow a small extracted `SourceAssetsPanel` component if it reduces complexity without broad refactoring.

## Validation plan

1. Run diagnostics on all modified preprocess components.
2. Run the relevant preprocess Playwright coverage for source-assets, localization, and alignment upload behavior.
3. Run build.
4. Manually verify on `/preprocess` that both images can be uploaded/replaced from `Source Assets`, that `Localize` and `Align` no longer show upload controls, and that both steps still function once assets are present.

## Out of scope

- Changing localization transform behavior.
- Changing alignment landmark behavior or solve logic.
- Changing the preprocess project data model for source images.
- Redesigning preprocess steps beyond the upload ownership change.
