## Topic

Preprocess tissue selection parity update: replace the current spot-override panel with a canvas editor that matches `src/app/spatial/page.tsx` interaction patterns and exports the requested chip-sized matrix.

## Goal

Keep scope strictly limited to the preprocess tissue-selection flow:

1. Replace the current `TissueSelectionPanel` spot-toggle UI with a true canvas editor.
2. Restore working selection and deletion behavior consistent with `src/app/spatial/page.tsx`.
3. Preserve preprocess-specific auto-selection as an input, but make region editing the manual source of truth.
4. Export the final tissue result as the chip-sized matrix expected by the chosen chip type: `50x50` for `50um`, `96x96` for `15um`.

## Context

- Current preprocess tissue UI lives in `src/app/preprocess/components/TissueSelectionPanel.tsx` and only edits `forcedInSpotIds` / `forcedOutSpotIds` through point clicks and drag-box add/remove.
- `src/app/preprocess/components/PreprocessWorkspace.tsx` stores preprocess tissue state in `project.tissueSelection`, including `regions`, `selectedRegionId`, `selectedSpotIds`, override arrays, summary, and export invalidation.
- `src/types/preprocess.ts` already defines `TissueRegion`, `tissueSelection.regions`, and `selectedRegionId`, but the current preprocess UI does not drive those fields.
- The reference interaction model is `src/app/spatial/page.tsx`, which already implements normalized canvas coordinates, `draw/edit/erase` tools, click selection, modifier-based multi-select, delete-selected, punch-out erase, and region-based export.
- Current preprocess auto-selection logic in `src/lib/preprocess/tissuePipeline.ts` returns spot IDs, not polygon regions, so the manual editor must layer on top of the projected spot grid rather than replacing the auto-selection pipeline itself.
- Current preprocess chip manifests are asymmetric with the request: `public/preprocess-chip-configs/50um/manifest.json` is `64x64`, while `15um` is already `96x96`. The approved target requires the `50um` path to export `50x50`, so implementation must update the preprocess 50um grid definition rather than preserving the current `64x64` output.

## Approaches Considered

### Approach A (recommended): Replace preprocess tissue editing with a spatial-style region canvas

- Reuse the spatial interaction model: normalized viewport math, region hit-testing, draw/edit/erase tools, selected-region deletion, and punch-out erase.
- Keep preprocess auto-selection output as a generated spot mask, then derive final selected spots from the union of auto-selection and manual region edits.
- Keep export in preprocess, but compute output by intersecting projected spot rectangles against the final region mask.

**Pros**: matches the requested UX, fixes the current structural gap, aligns with existing repo behavior, and makes deletion a first-class concept instead of a spot-toggle side effect.
**Cons**: larger change than patching the current panel.

### Approach B: Patch the current spot-override panel to support inspect drag-select and clearer delete actions

- Keep spot circles as the primary editing model.
- Fix drag-box behavior in inspect mode and add explicit clear/remove actions.

**Pros**: smaller diff.
**Cons**: still does not match `src/app/spatial/page.tsx`, still lacks region-based editing, and keeps deletion as spot removal rather than region deletion.

### Approach C: Extract a shared reusable canvas editor used by both spatial and preprocess

- Refactor spatial first, then mount the shared editor in preprocess.

**Pros**: strongest long-term reuse story.
**Cons**: unnecessary scope expansion for this task and a higher regression risk in the already-working spatial route.

## Chosen Design

Use Approach A.

### Interaction model

The preprocess tissue step will adopt the same editing model as `src/app/spatial/page.tsx`:

1. A canvas host renders the crop image, projected spot overlay, existing tissue regions, and in-progress draw/erase path previews.
2. Tools become `draw`, `edit`, and `erase` instead of `inspect`, `add`, and `remove`.
3. In `edit` mode, clicking a region selects it; plain click replaces selection, Ctrl/Cmd toggles selection, and Shift extends selection range using the sidebar list.
4. Empty-space drag or middle-mouse drag pans the viewport.
5. `Delete selected` removes the active tissue regions.
6. `Erase` draws a punch-out polygon against selected regions, matching spatial’s destructive geometry workflow.

### Source of truth

`project.tissueSelection.regions` becomes the manual editing source of truth for tissue geometry.

- `selectedRegionId` should be expanded to a preprocess-local selected-region array in component state, mirroring spatial’s `selectedRegionIds` behavior.
- `selectedSpotIds` remains the persisted output needed by export and downstream workflow gating.
- `forcedInSpotIds` and `forcedOutSpotIds` stop being the primary editing mechanism. They may either be retired or treated as derived compatibility fields during migration, but the UI no longer manipulates them directly.

### Auto-selection relationship

Auto-selection remains available as a preprocessing step:

1. `runTissueAutoSelection(...)` still computes an initial spot-level tissue mask.
2. That result seeds the initial selected-spot set and can optionally initialize a preview overlay.
3. Manual region editing then becomes authoritative for the final output.
4. Any manual edit invalidates stale export state exactly once through the existing `onProjectMutate(...)` pathway in `PreprocessWorkspace`.

### Canvas and helper reuse

The preprocess implementation should reuse existing shared logic where possible instead of inventing new math:

- `src/lib/canvasViewport.ts` for base view, transform, pointer-to-image normalization, and zoom anchoring.
- `src/lib/geometry.ts` for region path handling, hit-testing, and rectangle intersection.
- Spatial’s selection semantics and punch-out behavior as the behavioral reference.

This is a behavior-parity task, not a visual redesign. Chakra layout may remain preprocess-specific as long as the editing surface and controls behave like spatial.

## Component changes

1. **`src/app/preprocess/components/TissueSelectionPanel.tsx`**
   - Replace the current SVG spot-toggle panel with a canvas-based tissue editor.
   - Add viewport state (`zoom`, `pan`, host rect), tool state (`draw` / `edit` / `erase`), in-progress path state, and selected-region state.
   - Render the crop image plus projected spots and manual regions using normalized coordinates.
   - Add region list + delete-selected controls consistent with spatial’s selection workflow.

2. **`src/app/preprocess/components/PreprocessWorkspace.tsx`**
   - Change the tissue step wiring so manual edits mutate `tissueSelection.regions` first.
   - Derive `selectedSpotIds` from the final region mask plus any intended auto-selection base state.
   - Keep export invalidation and status transitions centralized in `onProjectMutate(...)`.
   - Keep threshold inputs and `Run auto-selection` control intact.

3. **Shared helper usage / small utility additions**
   - Reuse `canvasViewport` and `geometry` helpers directly.
   - Add only minimal preprocess-specific helpers if needed for converting region geometry into selected chip spots.
   - Avoid refactoring `src/app/spatial/page.tsx` into shared components unless a tiny extraction is clearly necessary.

## Data flow and export impact

Final tissue export should follow this path:

1. `chipConfig.projectedSpots` provides the chip-sized grid.
2. Each projected spot is treated as a spot rectangle in normalized crop coordinates.
3. A spot is selected if it falls within the final tissue region mask.
4. Export writes the chip-sized matrix corresponding to the requested active chip type:
   - `50um` => `50x50` (this is a deliberate change from the current preprocess `64x64` manifest)
   - `15um` => `96x96`
5. Spots outside the final tissue mask export as zero / unselected.

This keeps preprocess output aligned with the spatial route’s region-to-grid labeling approach while preserving preprocess’s existing chip projection step.

## Acceptance criteria

1. The tissue step uses a canvas editor instead of the current spot-only overlay.
2. Users can draw tissue regions over the crop image.
3. Users can select existing regions from the canvas and delete them with an explicit delete-selected action.
4. Users can erase parts of selected regions with a punch-out workflow.
5. Selection and deletion work reliably with normalized coordinates and no overlay/image drift.
6. Running auto-selection still works and does not break subsequent manual editing.
7. Export produces the requested chip-sized tissue matrix for `50um` and `15um` projects, specifically `50x50` and `96x96`.

## Risk and mitigation

- Risk: mixing old spot-override fields with new region editing could leave two competing sources of truth.
  - Mitigation: define `regions` as the manual editing source of truth and derive export-facing spot selections from it in one place.
- Risk: preprocess crop-stage dimensions may drift from overlay coordinates.
  - Mitigation: use the same viewport transform approach as spatial instead of relying on independent image and SVG sizing.
- Risk: changing the preprocess `50um` chip grid from `64x64` to `50x50` could affect spot projection, counts, and any fixture assumptions.
  - Mitigation: confine the grid-shape change to preprocess chip-config assets and any directly dependent projection/export code, then manually verify the exported matrix shape.
- Risk: large refactors in spatial could introduce regressions outside preprocess.
  - Mitigation: reuse helpers, not a cross-route editor extraction, unless absolutely required.

## Validation plan

1. Run diagnostics on all modified preprocess files.
2. Run lint.
3. Run build.
4. Manually verify on `/preprocess` that draw, select, delete, erase, and export all work on a real preprocess project.
5. Confirm the exported result shape matches the active chip type expectation (`50x50` or `96x96`).

## Out of scope

- Refactoring the existing spatial route into reusable components.
- Changing auto-selection threshold logic in `tissuePipeline.ts`.
- Adding new export formats beyond the existing preprocess export surface.
- Redesigning other preprocess steps outside tissue selection.
