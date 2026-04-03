## Topic

Alignment panel minimal UI update: replace side-by-side landmark panes with subtabs and constrain the image stage to better fit the viewport.

## Goal

Keep scope strictly limited to `src/app/preprocess/components/AlignmentPanel.tsx`:

1. Convert the two large alignment panes into Chakra subtabs.
2. Keep current landmarks interactions unchanged (add/move/delete, zoom, solve flow).
3. Scale the image stage to fit page height more predictably.

## Context

- Current layout uses `<Flex direction={{ base: 'column', xl: 'row' }} gap={5}>` with two `LandmarkCanvas` blocks.
- Existing project tab pattern is in `LocalizationPanel.tsx` (`Tabs`, `TabList`, `TabPanels`, `TabPanel`, `variant='enclosed'`, `size='sm'`, `isLazy`).
- Landmark canvas currently has `minH='320px'` and absolute-positioned image rendering based on `computeBaseView(...)`.

## Approaches Considered

### Approach A (recommended): Replace pane `Flex` with Chakra `Tabs` in `AlignmentPanel`

- Use the same tab primitives/pattern as `LocalizationPanel`.
- Put each `LandmarkCanvas` into its own `TabPanel`.
- Add height constraints in `LandmarkCanvas` container with responsive Chakra props (retain minimum floor).

**Pros**: smallest diff, consistent UI pattern, low risk.
**Cons**: no advanced split-screen comparison.

### Approach B: Keep `Flex` and collapse one panel with accordion-like toggles

**Pros**: less semantic change than tabs.
**Cons**: custom behavior, less consistent with existing tabs usage.

### Approach C: Keep two panes, only shrink with tighter min/max heights

**Pros**: least structural change.
**Cons**: does not satisfy subtab requirement.

## Chosen Design

Use Approach A.

### Component changes

1. In `AlignmentPanel.tsx`, import Chakra tab components:
   - `Tabs`, `TabList`, `Tab`, `TabPanels`, `TabPanel`
2. Replace current two-canvas `<Flex ...>` block with:
   - `<Tabs size='sm' variant='enclosed' isLazy>`
   - `Tab 1`: "Eosin landmarks"
   - `Tab 2`: "H&E landmarks"
   - each tab panel contains one existing `LandmarkCanvas` call (same props as today).
3. In `LandmarkCanvas`, adjust the canvas container sizing from only `minH='320px'` to viewport-aware bounds:
   - keep `minH='320px'`
   - add `h={{ base: '52vh', xl: '58vh' }}`
   - add `maxH='680px'`

This keeps the current coordinate math and drawing code untouched while reducing oversized page consumption.

## Data flow and behavior impact

- No state model changes.
- No changes to control point IDs, alignment solver, quality gating, or save/update handlers.
- No changes to Crop+QC panel.

## Risk and mitigation

- Risk: viewport-constrained height could feel tight on very small screens.
  - Mitigation: preserve `minH='320px'` and allow scroll in outer layout as needed.

## Validation plan

1. Type/diagnostics on modified file (`AlignmentPanel.tsx`).
2. Run lint.
3. Run build.
4. Confirm no behavior regressions in point placement/drag/delete flow by static code-path inspection.

## Out of scope

- Any new alignment features.
- Crop+QC UI restructuring.
- Changing alignment solve logic or thresholds.
