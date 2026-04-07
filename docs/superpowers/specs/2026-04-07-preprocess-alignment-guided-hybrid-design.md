## Topic

Preprocess alignment guided hybrid redesign: move alignment operations into floating canvas overlays, make pair-point creation explicitly guided, and replace global add/move/delete modes with point-selection-driven editing.

## Goal

Keep scope focused on the preprocess alignment step:

1. Make Alignment feel visually consistent with Localize by floating operation areas over the canvas surfaces.
2. Redesign Pair points for a safer, more guided workflow with fewer accidental edits.
3. Preserve the existing alignment solver, quality gates, and persisted data model unless a small UI-facing extension is clearly required.
4. Keep the Eosin/H&E dual-canvas workflow, but reduce visual clutter and separate workflow controls from per-canvas view/transform controls.

## Context

- Current alignment UI lives in `src/app/preprocess/components/AlignmentPanel.tsx`.
- The alignment step is mounted from `src/app/preprocess/components/PreprocessWorkspace.tsx` when `project.currentStep === 'alignment'`.
- Current Localize UI in `src/app/preprocess/components/CanvasStage.tsx` already uses the target visual pattern: a `position='relative'` stage with floating overlays in the top-right and bottom-left corners.
- Current Alignment mixes three concerns in one long top-of-page stack: pair-point editing, solve/status controls, and moving-image transform controls.
- Current point editing is represented by `EditorTool = 'add' | 'move' | 'delete'`, with a hidden two-click cross-canvas pairing model driven by `pendingPair`.
- Clicking an existing point currently behaves according to the global mode rather than the selected point itself, which makes editing more modal than necessary.

## Approaches Considered

### Approach A: Fully canvas-first overlays with minimal persistent paneling

- Push nearly all controls into the canvas corners.
- Keep only a tiny status strip outside the stage.

**Pros**: very lightweight, visually modern.
**Cons**: weaker guidance, easier to miss state, not the best fit for a safety-first workflow.

### Approach B: List-first guided editor

- Add a dominant persistent pair list with selection and edit actions.
- Use canvas mostly for placement and inspection.

**Pros**: highly explicit and safe.
**Cons**: slower for actual image registration work and too form-heavy for this task.

### Approach C (recommended): Guided hybrid workspace

- Keep the two canvases as the main stage.
- Add one shared floating workflow panel for Pair points, status, and solve actions.
- Add small canvas-local corner panels for zoom and image-transform actions.
- Replace global move/delete modes with point-selection-driven contextual editing.

**Pros**: best balance of guidance, safety, and stage-first alignment work; directly reuses Localize’s proven overlay pattern.
**Cons**: moderate UI refactor inside `AlignmentPanel.tsx`.

## Chosen Design

Use Approach C.

### Workspace layout

Alignment becomes a stage-based workspace rather than a document-flow form.

1. Keep both canvases visible side by side on xl+ screens and stacked on smaller screens.
2. Wrap each canvas in a `position='relative'` surface similar to `CanvasStage` so overlays can be anchored to canvas corners.
3. Add one shared floating workflow panel anchored over the alignment stage rather than above it in normal flow.
4. Add a small floating view-controls panel on the Eosin/reference canvas.
5. Add a small floating view+transform panel on the H&E/moving canvas.

This preserves the existing two-canvas mental model while removing the current long control stack that competes with the stage for attention.

### Pair points interaction model

The default interaction becomes guided pair creation without a persistent global add/move/delete toolbar.

1. The shared workflow panel always shows the current instruction:
   - “Click a point on Eosin”
   - then “Click the matching point on H&E”
   - then confirmation that the next pair is ready.
2. After the first click, the half-complete pair remains visibly highlighted on the originating canvas until the second click completes the pair.
3. Completed pairs remain numbered exactly as today so correspondence stays easy to scan.
4. Clicking an existing point selects that pair across both canvases.
5. Selection opens contextual pair actions in the shared panel instead of changing the entire workspace mode.

### Point editing model

Editing existing pairs becomes selection-driven rather than mode-driven.

1. Clicking a point selects its pair and highlights both landmarks.
2. The shared panel shows contextual actions for the selected pair:
   - reposition Eosin point
   - reposition H&E point
   - delete pair
   - cancel selection
3. Reposition is a short guided sub-state, not a broad global mode. Example: after choosing “Reposition H&E point”, the panel instructs the user to click the new H&E location.
4. Destructive actions stay secondary in the UI and only appear when a pair is selected.

This keeps editing available, but reduces accidental deletes and removes the need for users to mentally map a global tool state onto two canvases.

### Controls and status hierarchy

The shared workflow panel must be visually compact and prioritized by decision importance.

1. Top section: pair count, solve readiness, OpenCV/runtime status, and current alignment status.
2. Middle section: current instruction, pending half-pair state, and selected-pair contextual actions.
3. Primary action: `Solve alignment`.
4. Secondary actions: undo last pair, clear all pairs, and force continue only when relevant.
5. Diagnostic details such as quality metrics and affine matrix move into a lower details area or collapsible section so they remain available without dominating the workflow.

### Canvas-local overlays

Per-canvas overlays must only contain controls local to that canvas.

1. Reference/Eosin overlay:
   - zoom controls
   - reset zoom/view action
2. Moving/H&E overlay:
   - zoom controls
   - rotation controls
   - scale controls
   - flip actions
   - reset transform
3. Both overlays must follow the same visual treatment already used in `CanvasStage.tsx`: dark translucent panel, light border, rounded corners, blurred backdrop.

This separates workflow controls from image-prep controls and prevents the moving-image transform block from visually overwhelming Pair points.

### State ownership

The redesign must keep a strict boundary between persisted alignment data and ephemeral UI state.

**Persisted in `AlignmentSlice` (existing source of truth):**

- `controlPoints`
- `movingImageTransform`
- `inlierMask`
- `affineMatrix`
- `reprojectionRmse`
- `inlierRatio`
- `ransacReprojThreshold`
- `qualityFlags`
- `solveAccepted`
- `failureReason`
- `transform`
- step `status` / `error` / `updatedAt`

**Local-only UI state inside the alignment UI:**

- current guided action state (`idle-add`, `awaiting-source`, `awaiting-target`, `selected-pair`, `reposition-source`, `reposition-target`)
- pending half-pair before a completed pair is committed to `controlPoints`
- selected pair id
- OpenCV runtime loading surface state (`runtimeStatus`, `runtimeError`)
- per-canvas zoom and pan state
- per-canvas drag state and pointer-tracking state
- collapse/visibility state for diagnostic sections

Rules:

1. Pending half-pairs are **not persisted** to `AlignmentSlice`.
2. Pair selection and reposition sub-state are **not persisted**.
3. Per-canvas zoom/pan remain independent and **do not** sync between canvases.
4. Only completed pair commits, moving-image transform changes, and solve/reset actions mutate `AlignmentSlice`.

### Interaction contract

The redesign must define one unambiguous behavior for each user action.

#### Pair creation

1. Default entry state is `awaiting-source`.
2. Clicking the reference/Eosin canvas background records a local pending source point and advances to `awaiting-target`.
3. Clicking the moving/H&E canvas background while in `awaiting-target` creates one new `AlignmentControlPoint`, clears the pending state, and returns to `awaiting-source`.
4. Clicking the wrong canvas while a half-pair is pending does not create a second source or second target point; the UI must keep the current instruction and require the complementary click.
5. A completed pair must continue to use one shared pair id across both visible landmarks.

#### Pair selection

1. Clicking either visible landmark circle selects the whole pair, not an individual side.
2. Selecting a pair highlights both landmarks and opens contextual actions in the shared workflow panel.
3. Only one pair is selected at a time.
4. Clicking empty canvas space clears selection unless a reposition action is active.

#### Reposition

1. `Reposition Eosin point` enters `reposition-source` and keeps the pair selected.
2. The next valid click on the Eosin/reference canvas rewrites only that pair’s `source` point, clears the reposition state, and resets solve-derived outputs.
3. `Reposition H&E point` does the same for the moving canvas and only rewrites that pair’s `target` point.
4. Reposition does not require or expose the old global `move` mode.

#### Delete and reset

1. `Delete pair` removes the whole selected `AlignmentControlPoint` by pair id.
2. `Undo last pair` removes the most recently committed pair, not a pending half-pair.
3. `Clear all pairs` removes all committed pairs and clears any local pending/selection/reposition state.

#### Viewport behavior

1. Background drag continues to pan only the canvas being dragged.
2. Wheel zoom continues to affect only the hovered canvas and must not scroll the page.
3. Switching guided action state, selecting a pair, solving, or expanding diagnostics must not reset zoom/pan.

#### Legacy modes

The old `Add`, `Move`, and `Delete` global toolbar buttons are removed from the primary UI. The redesign does not keep them as visible fallback controls.

## Component changes

1. **`src/app/preprocess/components/AlignmentPanel.tsx`**
   - Keep it as the main integration point for alignment UI and behavior.
   - Replace the current top-level control stack with a stage-based layout plus floating overlays.
   - Introduce smaller local UI units inside this file or extracted from it if the component becomes too large.

2. **Local UI units within the alignment component tree**
   - a shared workflow overlay panel
   - a reusable floating panel shell for canvas-corner controls
   - a refined landmark canvas that supports selected-pair and pending-pair visuals

3. **`src/app/preprocess/components/PreprocessWorkspace.tsx`**
   - Keep the mount point the same.
   - No step-flow redesign is needed beyond whatever prop changes are required by the updated alignment panel surface.

## Data flow and behavior impact

- Preserve `alignment.controlPoints`, `pendingPair`, solver state, runtime state, and moving-image transform as the underlying alignment data.
- Preserve current solving behavior, OpenCV loading, quality gates, and downstream invalidation semantics.
- The main behavioral change is how editing intent is represented in UI state:
  - less dependence on global `add` / `move` / `delete`
  - more dependence on guided pair creation and selected-pair sub-actions.
- If new UI state is introduced, it must stay component-local unless persistence is clearly required.

### Status and invalidation contract

The redesign must preserve current preprocess workflow gating.

1. Creating a completed pair updates `alignment.controlPoints` and must reset solve-derived outputs through the existing solve-reset behavior.
2. Repositioning either side of an existing pair also resets solve-derived outputs.
3. Deleting a pair, undoing the last pair, or clearing all pairs also resets solve-derived outputs.
4. Updating `movingImageTransform` remains a display-only action and continues to call `onAlignmentChange(..., { invalidateDownstream: false })`.
5. Local-only UI state changes — pending half-pair, pair selection, reposition sub-state, panel open/closed state, zoom/pan — must not invalidate downstream preprocess steps.
6. `Solve alignment` and `Force continue` remain the only actions that may transition alignment into an accepted/rejected solved status.
7. Crop/QC reachability must continue to depend on the persisted alignment step state reaching the same “complete” condition as today.

### Testability contract

The redesign must preserve or deliberately replace the current e2e-observable alignment hooks.

1. The pair-count, runtime-status, solve-status, solve button, force-solve button, and distribution-warning test ids must remain stable unless there is a documented selector migration.
2. If canvas host test ids change, the spec must require equivalent stable selectors for:
   - reference canvas click target
   - moving canvas click target
   - pair count badge
   - solve action
   - reset/clear action
3. Existing behavior currently covered by `tests/e2e/preprocess-hardening.spec.ts` must remain testable after the redesign:
   - creating one pair across both canvases
   - H&E transform controls visible on the alignment step
   - wheel zoom not scrolling the page
   - dragging one canvas panning independently
   - repeated solve/reset stability
   - clustered landmarks remaining blocked from enabling crop

## Acceptance criteria

1. Alignment operation areas visually float over the canvases in the same family as Localize rather than sitting only in normal page flow.
2. Pair-point creation clearly communicates the two-step Eosin → H&E workflow.
3. Users can click an existing point to select the pair and edit it through contextual actions.
4. Users no longer need a heavy global Move/Delete toolbar to perform routine pair editing.
5. Solve/status information remains visible and understandable during editing.
6. Moving-image transform controls remain available, but are visually separated from Pair points workflow controls.
7. Existing alignment solve behavior and persisted control-point structure remain intact.
8. Pending half-pairs, selected pair state, and reposition mode do not persist after reload because they are local-only UI state.
9. Per-canvas pan/zoom remain independent and survive selection/solve UI changes during the session.
10. Display-only H&E transform changes do not invalidate downstream preprocess steps until solving changes persisted alignment results.

## Risk and mitigation

- Risk: the redesign could accidentally make expert editing slower.
  - Mitigation: keep point selection immediate and keep reposition flows to one explicit follow-up click.
- Risk: floating overlays could obstruct the stage on smaller screens.
  - Mitigation: keep overlays compact, anchor them to corners, and allow responsive stacking when space is tight.
- Risk: mixing pending-pair, selected-pair, and reposition sub-state could create confusing UI state transitions.
  - Mitigation: use a small explicit interaction-state model with clear mutually exclusive states and visible instructions.
- Risk: a large refactor inside `AlignmentPanel.tsx` could introduce regressions in solve/reset behavior.
  - Mitigation: keep solver/data-path logic unchanged where possible and focus the refactor on layout and interaction handling.

## Validation plan

1. Run diagnostics on all modified alignment/preprocess files.
2. Run lint.
3. Run build.
4. Manually verify on `/preprocess` that guided pair creation, pair selection, reposition, delete, solve, and moving-image transform controls all work end to end.
5. Confirm that solving still updates the same quality/status outputs expected by downstream crop/QC.

## Out of scope

- Rewriting the alignment solver or changing quality thresholds.
- Redesigning other preprocess steps beyond Alignment.
- Refactoring Localize into shared reusable components unless a tiny shared panel shell is obviously beneficial.
- Changing preprocess storage or export behavior.
