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
- Step 3 has two modes. `project` draws once on the reference. `perImage` confirms
  the reference outline, then walks every package through **two independent panels
  side by side**: a `locked` read-only `BatchRegionStage` for the reference (no
  drawing, no view zoom) and an interactive one for the package being drawn, whose
  view can be zoomed freely. Both panels keep their own frames, so package regions
  are stored in package coordinates and the reference only appears there through
  `mapReferenceRegionsToPackage` as a dashed guide.
- The reference package is `image[0]`: the first ready package in the import.
- Region edits per package are overrides. Untouched packages are recomputed from
  the reference region on every render so a later alignment change still applies.
- `transform-matrix.csv` defaults to the **source frame**: package pixels map to a
  canvas the same size as that package's own image, so the linear part equals the
  rotate/scale that was dialled in. The reference frame stays selectable for
  cross-package coordinate work and differs only by the size ratio.
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
