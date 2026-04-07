## Topic

Preprocess localization UI simplification: remove the right-side Properties rail and make the canvas top-right floating widget the only control surface for localization view actions.

## Goal

Keep scope strictly limited to the `Chip localization` step on `/preprocess`:

1. Remove the full right-side `Properties` rail from the localization step.
2. Expand the floating widget in the canvas top-right so it becomes the only place for localization view controls.
3. Add compact icon-style rotation controls for both quarter turns and 1° fine adjustments.
4. Keep `Flip` as its own section and `Reset` as its own section.
5. Define reset as: rotation back to `0°`, both flips off, and zoom back to `100%`.
6. Avoid changing localization geometry, persistence, or downstream preprocess behavior.

## Context

- `src/app/preprocess/components/PreprocessWorkspace.tsx` already owns the localization transform update flow through `applyLocalizationUpdate(...)` and already wires `CanvasStage` and `LocalizationPanel` to the same `project.localization.imageTransform` state.
- `src/app/preprocess/components/CanvasStage.tsx` already renders the floating top-right widget for zoom and ±90° rotation, plus the current zoom/rotation readouts.
- `src/app/preprocess/components/LocalizationPanel.tsx` currently contains the broader right-side control surface, including image details, chip box color, exact numeric rotation/scale inputs, fine rotation buttons, flip buttons, and reset.
- `src/types/preprocess.ts` already models the transform shape as `rotationDegrees`, `flipHorizontal`, `flipVertical`, and `scale`.
- `src/lib/preprocess/localization.ts` already defines `DEFAULT_LOCALIZATION_IMAGE_TRANSFORM`, which matches the approved reset target.
- The user approved a simplified layout with no Properties rail, a floating-widget-only control model, `Flip` and `Reset` as separate sections, and icon-style rotation buttons using the `A` direction (`↺90`, `↻90`, `↺1`, `↻1`).

## Approaches Considered

### Approach A (recommended): Remove the Properties rail and promote the floating widget to the only control surface

- Delete the localization-step rendering of `LocalizationPanel` from the workspace layout.
- Keep the existing workflow rail on the left and the main canvas area in the center/right.
- Expand the floating widget in `CanvasStage.tsx` into stacked groups: `Zoom`, `Rotation`, `Flip`, and `Reset`.
- Reuse the existing workspace callbacks for zoom, rotation, flip, and reset rather than introducing new transform logic.

**Pros**: matches the approved UX exactly, reduces visual clutter, keeps localization focused on the canvas, and avoids duplicating controls in two places.
**Cons**: intentionally drops current secondary controls such as image details, chip box color, and exact numeric transform inputs.

### Approach B: Keep the Properties rail but visually de-emphasize it

- Add the new floating controls but retain the right-side panel as a secondary settings area.

**Pros**: lowest product risk because no existing controls disappear.
**Cons**: does not satisfy the approved simplification and keeps two competing places to control the same transform state.

### Approach C: Remove the full rail but move every former control into the floating widget

- Preserve image details, chip box color, and exact numeric inputs by packing them into the floating widget.

**Pros**: avoids losing capabilities.
**Cons**: turns the floating widget into a dense mini-panel and conflicts with the approved minimal direction.

## Chosen Design

Use Approach A.

### Layout responsibilities

#### Workflow rail

The existing left-side workflow rail remains unchanged.

- Step navigation, gating, and status continue to live there.
- No new control responsibilities are added to the workflow rail.

#### Localization canvas area

The main localization area becomes a cleaner two-part layout:

- left: workflow rail
- main: localization canvas and overlays

There is no separate right-side `Properties` column in the localization step anymore.

#### Floating widget

The canvas top-right floating widget becomes the only transform control surface for localization.

It should remain compact and vertically grouped into four sections:

1. **Zoom**
   - keep the current zoom value readout
   - keep quick zoom in/out actions
2. **Rotation**
   - keep the current rotation value readout
   - provide four icon-style buttons: `↺90`, `↻90`, `↺1`, `↻1`
3. **Flip**
   - separate section
   - provide horizontal and vertical flip toggle buttons
4. **Reset**
   - separate section
   - provide one reset action

### Interaction behavior

This is a UI ownership/layout change, not a transform-model change.

1. `↺90` and `↻90` continue to apply quarter-turn deltas.
2. `↺1` and `↻1` apply 1-degree fine deltas.
3. Horizontal and vertical flip remain independent toggles.
4. Reset writes the default localization transform back into state.
5. Reset means exactly: `rotationDegrees = 0`, `flipHorizontal = false`, `flipVertical = false`, `scale = 1`.
6. The existing visible zoom and rotation readouts remain in the widget so users still get exact feedback even after numeric inputs are removed.

### Explicit removals

The localization step intentionally loses the following UI:

- the full `Properties` rail
- image details block
- chip box color controls
- canvas-controls helper text block from the rail
- exact numeric rotation input
- exact numeric scale input
- duplicate fine rotation / flip / reset controls from the rail

These controls are removed rather than relocated, except for the transform actions that are deliberately re-homed into the floating widget.

### Component changes

1. **`src/app/preprocess/components/PreprocessWorkspace.tsx`**
   - Remove `LocalizationPanel` from the localization-step layout.
   - Keep the existing localization state update callbacks.
   - Pass flip and reset callbacks into `CanvasStage` so the widget can own the full approved action set.
   - Adjust localization-step layout sizing after the right column disappears.

2. **`src/app/preprocess/components/CanvasStage.tsx`**
   - Expand the `localize-stage-controls` widget from `Zoom + Rotation` to `Zoom + Rotation + Flip + Reset`.
   - Add new button rows/sections for the approved actions.
   - Keep current zoom/rotation value readouts.
   - Use compact icon-style labels for the rotation buttons.

3. **`src/app/preprocess/components/LocalizationPanel.tsx`**
   - No longer rendered by the localization step.
   - It can be deleted if nothing else imports it after the change, or left temporarily unused only if removal would be deferred intentionally during implementation.

4. **`tests/e2e/preprocess-localize-panel.spec.ts`**
   - Update localization layout assertions so the tests reflect the new two-column experience.
   - Replace checks that expect the `Properties` rail and panel controls with checks for the expanded floating widget sections and actions.

## Acceptance criteria

1. The localization step no longer renders the right-side `Properties` rail.
2. The localization layout still shows the workflow rail and the localization canvas.
3. The floating top-right widget exposes four sections: `Zoom`, `Rotation`, `Flip`, and `Reset`.
4. The floating widget includes rotation buttons for `↺90`, `↻90`, `↺1`, and `↻1`.
5. The floating widget includes horizontal and vertical flip buttons in their own `Flip` section.
6. The floating widget includes a standalone `Reset` section that restores rotation `0°`, flips off, and zoom `100%`.
7. Existing localization drag/resize/rotate-canvas behavior still works.
8. The localization transform remains persisted through the existing preprocess project state model.

## Risk and mitigation

- Risk: removing the panel also removes exact numeric inputs, which may reduce precision for some users.
  - Mitigation: preserve visible readouts and add 1° controls so users still have fine-grained adjustment without an always-visible numeric editor.
- Risk: removing chip box color controls changes more than just transform affordances.
  - Mitigation: make the removal explicit in implementation and tests rather than leaving partially orphaned state/UI.
- Risk: the larger floating widget could crowd the canvas corner.
  - Mitigation: keep the widget vertically grouped and compact instead of flattening all actions into one dense row.
- Risk: tests currently encode the three-column shell and panel presence.
  - Mitigation: update Playwright expectations together with the UI change so layout coverage matches the approved design.

## Validation plan

1. Run diagnostics on all modified preprocess components.
2. Run the relevant preprocess Playwright coverage for localization layout and stage controls.
3. Run build.
4. Manually verify on `/preprocess` that the Properties rail is gone, the floating widget contains the approved sections, flip/reset work, ±90 and ±1 rotation work, and reset restores the approved default transform.

## Out of scope

- Changing localization transform math.
- Changing chip bounds geometry behavior.
- Changing preprocess storage or autosave architecture.
- Redesigning non-localization preprocess steps.
- Preserving the former panel-only informational blocks inside a new mini-panel.
