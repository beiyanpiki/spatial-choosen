# BATCH ROUTE GUIDE

## OVERVIEW
`src/app/batch/` is the multi-package NATA selection workspace: it aligns n
`tissue_fullres_image.png` sections to one reference package, annotates a single
region, and exports every package with an `in_selected` column plus a
`transform-matrix.csv`.

## STRUCTURE
```text
src/app/batch/
├── page.tsx / page.client.tsx   # client-only route shell
├── batchState.ts                # alignment + region resolution helpers
└── components/
    ├── BatchWorkspace.tsx       # step machine, import, align, region, export
    ├── BatchStepRail.tsx        # workflow rail
    ├── BatchImportPanel.tsx     # folder / zip / drag & drop import
    ├── BatchAlignStage.tsx      # manual rotate + scale overlay stage
    ├── BatchRegionStage.tsx     # freehand region stage (STEP6-style UI)
    └── stageSupport.ts          # image decode + viewport hooks
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Package grouping rules | `@/lib/batch/importPackages` | `<sample>/spatial/...` is the canonical layout |
| Rotate/scale maths | `@/lib/batch/affine` | Similarity params pivot on the moving image centre |
| Region projection | `batchState.resolveRegionsForPackage` | Reference frame -> package frame via the **inverse** transform |
| Barcode hit testing | `@/lib/batch/selection` | Regions are converted to package pixels first |
| Package export | `@/lib/batch/exportPackages` | Only `tissue_positions.csv` is rewritten |
| Matrix frame convention | `@/lib/batch/affine` | `DEFAULT_MATRIX_CONVENTION` is `source-frame` |
| Resuming an export | `@/lib/batch/resume` | Recovers alignment + selection from a step 5 zip |

## CONVENTIONS
- Regions are stored in normalized `0..1` coordinates of the image that owns them.
- Alignment parameters always describe `moving -> reference`; projecting the
  reference selection onto a package therefore needs the inverted matrix.
- Steps 3 and 4 show **two panels side by side**: a read-only (`interactive={false}`)
  `BatchRegionStage` for the reference and an interactive one for the package being
  drawn. Each panel owns its view — the reference uses `referenceViewBounds` and
  `referenceView`, the right one `viewBoundsFor(package)` and `walkthroughView` — so
  switching the picture on the right (or zooming it) never rescales the reference.
  Sharing one `viewBounds`/`viewZoom` again is a reported bug: the reference jumps
  every time another image is selected.
- `toolbarPlacement` picks where a `BatchRegionStage` parks its toolbar, and the
  modes are not interchangeable:
  - `floating` (the drawing panel of steps 3 and 4): absolute, just past the stage's
    right edge, so the picture keeps the whole column and the toolbar sits in the
    empty space beside it. It only wins while `window.innerWidth` really leaves room
    for `TOOLBAR_WIDTH_PX` past the row, otherwise it falls back to `outside` — never
    park it off screen;
  - `inside` (the reference panel next to it): absolute over the picture's top-right
    corner, which frees the column beside it for the picture being drawn;
  - `outside` (default, used by the full-width stages): the toolbar takes its own
    column and the picture shrinks to `flex='1 1 240px'`.
  All three share one DOM node — the toolbar is merely taken out of the flow — so
  drag, double-click-to-snap-back and the window clamp behave identically. The
  panel's first control is the left-drag mode: `Move image` or `Draw region`; the
  middle button pans in either mode.
- The step-3 walkthrough walks **every** ready package, the reference included, so
  the reference can be loaded into the right panel and appear on both sides. On the
  strip the chip loads the image into the right panel and the ☆ moves the reference
  (which also swaps the panel on the left), so never filter the reference out of
  `walkthroughPackages` or block `onSelect` for it.
- The reference package defaults to `image[0]` but any package can take its place
  through `changeReference`. It must invert the **new** reference's transform (the old
  reference is always the identity) and then re-base every alignment plus hand the
  regions over with `transferReferenceRegions`: anything drawn on the new reference
  becomes the reference outline, and the old outline becomes the old reference's own
  region. Miss either step and the operator's work appears to vanish.
- `changeReference` must leave the panel selection alone. Starring another chip only
  swaps the reference (and with it the panel on the left); the image on the right
  stays whatever the operator picked, so it can legitimately be the reference itself
  and the two panels then show the same photo. Forcing the right panel back to the
  old reference reads as "the photo jumped" and is a reported bug.
- Step 2 keeps one frame for everything: the batch reference. The stage shows the
  chosen base image **in the pose it was already given** (`baseParams` in
  `BatchAlignStage`), so picking an adjusted sample shows the adjusted sample, not the
  raw scan, and the dialled values stay the absolute `package -> reference` transform
  that gets exported.
- Step 2 aligns **any** ready package, the reference image included
  (`alignablePackages`), so the operator can also match image 1 onto another sample;
  the base then falls back to another image because a package cannot be its own base.
  That means the reference may carry a pose of its own (`referenceParams`), the batch
  frame being its original frame:
  - the outline stays in the reference image's own frame — lift it with
    `mapPackageRegionsToReference(referenceRegions, referenceParams)` before drawing or
    before handing it to a panel as `overlayRegions`, and pass the same params as
    `referenceParams` to `applySharedStroke` so a batch-frame stroke lands correctly;
  - `resolveRegionsForPackage` projects through the *relative* transform
    (`rebaseSimilarityParams(package, reference)`), which is the plain package
    transform only while the reference is at identity;
  - `changeReference` needs one extra hop when it re-bases the outline
    (`inverse(newReference) * oldReferencePose`), because the outline starts in the old
    reference image's frame.
- The base choice is per package (`alignLinks`, star a chip like step 3's reference).
  A dialled pose is recorded as a link with `linkAlignmentToBase`, and writes go
  through `applyAlignmentEdits`, which re-composes every dependant when a base moves,
  so a chain (`3 -> 2 -> 1`) follows later adjustments of image 2. Writing
  `alignments` directly drops that propagation and the chained image silently
  stops following.
- `alignBasePackage` is **fixed for the session**: the base the operator picked
  (`alignBaseId`, set by `chooseAlignBase`), else image[0], else any other sample, and
  it falls back only when the picked base *is* the image being moved. Per-package
  `alignLinks` are the follow relationship, never the layer shown underneath —
  consulting them here makes the base jump every time another sample is selected,
  which is exactly the bug that was reported.
- `PackageStrip` is the reorderable sample list used by steps 1, 3 and 4; the order is
  the `packages` array itself.
- Step 1's import table moves rows with the ↑/↓ buttons in the `Move` column as well as
  by dragging; the impossible direction is hidden rather than disabled (first row has
  no ↑, last row no ↓) and both paths call the same `movePackage`.
- Floating overlays use `useDraggableOverlay` from `stageSupport` (⠿ handle, drag with
  the pointer, double-click to snap back, clamped to the window). The step-2 transform
  panel and its matrix readout are both draggable; steps 3/4 use the same hook.
- Region edits per package are overrides. Untouched packages are recomputed from
  the reference region on every render so a later alignment change still applies.
- The `StrokeScopeToggle` decides where a stroke on an aligned panel lands, and the
  two steps keep **separate** state: step 3 defaults to `all`, step 4 to `image`.
  `all` goes through `applySharedStroke`: the stroke joins the reference outline so
  every adjusted image takes it — the read-only reference panel included — and packages
  that carry an override get the same stroke in their own frame, otherwise the
  override would mask the shared edit. `image` writes the package's own override
  through `commitPackageStroke`. Do not reintroduce a path that writes only
  `customRegions` while the scope is `all`.
- `referenceConfirmed` gates the per-image walkthrough in step 3 only. Switching the
  reference image, drawing, undoing or clearing must **not** reset it: the operator
  keeps annotating and would otherwise be bounced back to the confirm screen. The
  `Back to reference` button is the explicit way to leave the walkthrough.
- The reference outline has exactly one home: `referenceRegions`, keyed by
  `REFERENCE_REGION_KEY` in the undo history. Step 4 lets the operator draw on the
  reference panel, so `commitPackageStroke` / `undoPackageRegions` /
  `clearPackageRegions` route the reference package there instead of writing
  `customRegions[referenceId]`; a second copy would be discarded the next time
  `changeReference` runs and those strokes would vanish.
- `transform-matrix.csv` defaults to the **source frame**: package pixels map to a
  canvas the same size as that package's own image, so the linear part equals the
  rotate/scale that was dialled in. The reference frame stays selectable for
  cross-package coordinate work and differs only by the size ratio.
- Regions carry a 1-based `colorId` from `@/lib/batch/regionColors`. It is the
  drawing colour, the exported `selected_class` value and the priority key: regions
  are classified in painting order and a later region overwrites an earlier one.
- The palette is open ended: 1–5 are built in, the `+` swatch appends operator
  colours with fresh ids, and `regionColor()` synthesizes a stable colour for any id
  that is missing from the palette (e.g. one recovered from an older export). Never
  clamp a class id to the built-in range.
- Added colours are **session state**: the picker only stages a value, the `Add`
  button creates the class, and startup calls `clearStoredRegionColors()` so a
  reload always starts from the built-in five.
- Colour classes are named `Group 1`… and the operator can rename them
  (`onRenameColor` → the `colorNames` map in `BatchWorkspace`). The id is the
  exported `selected_class` value, so a rename never renumbers a class.
- Undo is **one global stack**, not one stack per image (`@/lib/batch/regionHistory`),
  with one step per operation however many lists it touched. Switching samples
  must not disable it: the operator has to be able to revert the stroke they just
  made on the previous image.
- Step 3's `project` mode traces the shared region on **any** sample
  (`projectDrawPackageId`). The chosen image is shown already aligned to the
  reference frame with the outline as a dashed guide, and the stroke still goes
  through `commitSharedStroke`; only the reference itself is drawn in its own frame.
- Step 4's comparison toggle overlays the tissue a package already kept — the
  second column of its `tissue_positions.csv` (`in_tissue`, carried as
  `BatchSpot.inTissue`) — on the region drawn now: green is kept by both, amber
  only by the table, blue only by the region.
- No operator-facing string says "batch"; the page is the multi-slide alignment
  workspace (`BatchWorkspace.test.tsx` fails the build if the word comes back).
- Drawing has two stroke modes: `merge` (default) unions a stroke into the regions
  of the active class **and subtracts it from every other class**, so a new colour
  paints over what was underneath instead of blending; `cut` carves the stroke out
  of every region it touches. Both go through `applyRegionStroke`, so keep new tools
  on that path instead of mutating region lists by hand.
- Region edits are not reversible by dropping the last region, so every mutation
  snapshots the previous list in `regionHistoryRef` and Undo restores that snapshot.
- Steps 3 and 4 always show packages **already aligned to the reference**, so the
  polygons on screen live in the reference frame. Strokes are pushed back with
  `mapReferenceRegionsToPackage` and stored regions are lifted with
  `mapPackageRegionsToReference`; boolean ops therefore run on the displayed list
  and the result is converted back before storage.
- `BatchRegion.holes` exists because "Cut out" produces real holes. Point-in-region
  honours them, so keep using `isPointInRegion` rather than a bare ring test.
- Importing a zip that step 5 produced resumes the batch: the alignment is read back
  from `transform-matrix.csv` and the selection is rebuilt as the union of the
  `in_selected` spot squares, which re-runs to exactly the same barcodes. This is
  the round trip `resume.test.ts` guards.

## ANTI-PATTERNS
- Do not write barcode tests in normalized space; spots only exist in pixels.
- Do not assume `pxl_row_in_fullres` / `pxl_col_in_fullres` are spot centres. The
  contract stores the top-left corner of the spot square, and
  `DEFAULT_SELECTION_SETTINGS` pins both the anchor and the hit rule (a spot counts
  as soon as its square touches the region) now that the review step hides them.
- Do not rewrite unrelated files when exporting a package.
- Do not decode full-resolution images for display; build the downscaled preview
  derivative from `@/lib/batch/imagePreview` once per package.
