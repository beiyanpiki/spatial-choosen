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

The shared workflow panel should be visually compact and prioritized by decision importance.

1. Top section: pair count, solve readiness, OpenCV/runtime status, and current alignment status.
2. Middle section: current instruction, pending half-pair state, and selected-pair contextual actions.
3. Primary action: `Solve alignment`.
4. Secondary actions: undo last pair, clear all pairs, and force continue only when relevant.
5. Diagnostic details such as quality metrics and affine matrix move into a lower details area or collapsible section so they remain available without dominating the workflow.

### Canvas-local overlays

Per-canvas overlays should only contain controls local to that canvas.

1. Reference/Eosin overlay:
   - zoom controls
   - reset zoom/view action
2. Moving/H&E overlay:
   - zoom controls
   - rotation controls
   - scale controls
   - flip actions
   - reset transform
3. Both overlays should follow the same visual treatment already used in `CanvasStage.tsx`: dark translucent panel, light border, rounded corners, blurred backdrop.

This separates workflow controls from image-prep controls and prevents the moving-image transform block from visually overwhelming Pair points.

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
- If new UI state is introduced, it should stay component-local unless persistence is clearly required.

## Acceptance criteria

1. Alignment operation areas visually float over the canvases in the same family as Localize rather than sitting only in normal page flow.
2. Pair-point creation clearly communicates the two-step Eosin → H&E workflow.
3. Users can click an existing point to select the pair and edit it through contextual actions.
4. Users no longer need a heavy global Move/Delete toolbar to perform routine pair editing.
5. Solve/status information remains visible and understandable during editing.
6. Moving-image transform controls remain available, but are visually separated from Pair points workflow controls.
7. Existing alignment solve behavior and persisted control-point structure remain intact.

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
