# Preprocess Tissue Selection Performance Design

## Goal

Fix the current `/preprocess` tissue-selection workflow so crop outputs, tissue auto-detection, chip-size switching, and perceived responsiveness all match the required product behavior while preserving the existing page shell and Chakra-based styling.

## Approved Product Decisions

- Crop generation must create **three sizes per modality**:
  - `tissue_fullres_image`
  - `tissue_hires_image` with max side `2000px`
  - `tissue_lowres_image` with max side `800px`
- The above applies to both eosin and HE crops.
- **Eosin** three-size crops are internal-only and used only for tissue-selection runtime behavior.
- **HE** three-size crops must be retained in the final export artifacts.
- `scalefactors_json.json` must be recomputed from the crop result with:
  - `tissue_hires_scalef`
  - `tissue_lowres_scalef`
  - `spot_diameter_fullres`
  - `fiducial_diameter_fullres = 0.027`
- `spot_diameter_fullres` represents the **full-resolution square side length** for each spot, not a circular diameter.
- Tissue auto-detection must run on `tissue_lowres_image`.
- Final `tissue_positions.csv` must write `pxl_row_in_fullres` and `pxl_col_in_fullres` in **fullres pixel space**, converted back from lowres processing with explicit rounding.
- Switching chip size must **not** auto-run detection.
- Switching chip size must only regenerate crop-dependent projection state and clear stale tissue edit/detection state.
- Auto-detection `activation threshold` must use range `0.00` to `0.30` with step `0.01`.
- While auto-detection runs, the **entire Tissue Selection module** must be covered by a loading mask/disabled state.
- The run button must visibly animate so users can tell work is in progress.
- Spots must be treated as **squares**, not circles, during tissue detection and exported geometry metadata.
- The user explicitly requested **no test-writing in this pass**.

## Recommended Architecture

The implementation follows the user-selected **performance-first** approach. The crop stage becomes the canonical preprocessing boundary and is responsible for generating all reusable image assets and scale metadata once per crop change. Heavy image resizing and detection work must be removed from the hot render path and executed through a worker-backed or cooperatively chunked async pipeline so the UI remains responsive under large chip projections.

The architecture separates three layers of state:

1. **Crop assets** — canonical eosin/HE fullres, hires, and lowres crops plus scale metadata.
2. **Projection state** — chip-size-specific projected square spots and square side-length values derived from cached crop assets.
3. **Detection/edit state** — lowres detection results, default region, manual edits, and final selected spots.

This separation prevents chip-size switching from redoing expensive crop and resize work and keeps auto-detection as an explicit, user-triggered action.

## Crop Asset Pipeline

### Inputs

- current crop rectangle
- source eosin image
- source HE image

### Outputs

For each modality, generate:

- `*_fullres_image` — raw cropped image at crop resolution
- `*_hires_image` — cropped image resized so the max side is `2000px`
- `*_lowres_image` — cropped image resized so the max side is `800px`

### Persistence Rules

- Eosin crop variants stay internal-only and are used by tissue-selection runtime code.
- HE crop variants are retained for final export/package generation.

### Scale Metadata

The crop pipeline must produce `scalefactors_json.json`-compatible values using the same reference logic already identified in `ref/ref.ipynb`:

- `tissue_hires_scalef = hires_max_side / fullres_max_side`
- `tissue_lowres_scalef = lowres_max_side / fullres_max_side`
- `spot_diameter_fullres =` the fullres **square side length** derived from the projected spot footprint
- `fiducial_diameter_fullres = 0.027`

The reference notebook treats `spot_diameter_fullres` as the exported linear spot size value. In this project, that exported linear size must map to the square side length because spot geometry is square-based, not circular.

## Square Spot Model

All tissue-selection geometry must be updated to a square-footprint model.

### Required Behavioral Change

- projected spots are square footprints
- auto-detection evaluates square blocks
- exported `spot_diameter_fullres` is the square side length in fullres pixels
- no circular or elliptical tissue-coverage assumptions remain in the detection path

### Rationale

This matches the updated product requirement and also lowers compute cost because square sampling can use direct block reads rather than ellipse/circle masking.

## Detection Pipeline

### Detection Source

Auto-detection must consume `tissue_lowres_image`, not the fullres crop.

### Detection Semantics

- threshold mode remains `gray-min`
- activation threshold range is `0.00`–`0.30`
- activation threshold step is `0.01`
- block threshold behavior remains part of the internal parameter model unless separately removed later
- detection output is the raw threshold-based square-spot activation result

### Performance Strategy

The expensive auto-detection pass must not run directly on the main synchronous render path. Use a worker-backed execution path if practical in this codebase, or a cooperatively chunked async executor if worker integration is too invasive. In either version, the UI contract is the same:

- enqueue detection work
- immediately enter loading/disabled state
- resolve the async job
- write the new default region and selection state in one completion step

### Edit State Outcome

After auto-detection completes:

- the detected result becomes one default editable region
- that region becomes the selected region
- selected spots are derived from the generated region
- any prior manual tissue edits are replaced rather than merged on rerun

## Chip-Size Switching

Chip-size switching must become a lighter-weight operation than the current implementation.

### Required Behavior

On chip-size change:

- clear prior tissue detection state
- clear prior manual edits and punch-outs
- clear selected spots / selected region state tied to the old projection
- recompute chip projection from the cached crop assets
- recompute square side length / spot metadata for the new chip size
- **do not** auto-run tissue detection

### Performance Goal

Chip-size switching should avoid recomputing crop assets or blocking the UI with unnecessary image-resize work. The redesign should make switching chips depend only on cached crop products plus the new chip projection math.

## UI and Interaction Behavior

### Visibility

- The three generated crop sizes remain completely internal.
- The user still sees the normal tissue-selection preview canvas rather than explicit asset-selection UI.

### Loading Contract

During auto-detection:

- the full Tissue Selection module receives a loading overlay / disabled mask
- controls and editing interactions are blocked until the detection pipeline finishes
- the run button shows explicit motion/animation so users can tell work is active

This loading state is tied to the real async detection lifecycle, not a cosmetic timeout.

### Existing Redesign Constraints To Preserve

- larger tissue-selection workspace
- chip size remains inside tissue-selection step
- existing edit / draw / punch-out interaction model remains intact
- Chakra-based light-theme styling remains intact

## Fullres Coordinate Export

Although auto-detection runs against the lowres crop, final exported coordinates must be written in fullres pixels.

### Required Conversion

For each final selected spot:

- maintain lowres-space detection/projection logic internally where needed
- convert `pxl_row_in_fullres` and `pxl_col_in_fullres` back to fullres coordinates using the crop scale relationship
- apply explicit rounding when writing CSV values

The implementation should follow the reference pattern already identified from `ref/ref.ipynb`, where exported coordinates are rounded to integer fullres pixels.

## Export / Package Requirements

Final export must preserve downstream expectations while reflecting the new asset model.

### Exported Assets

- HE fullres crop
- HE hires crop
- HE lowres crop
- updated `scalefactors_json.json`
- updated `tissue_positions.csv`

### Internal-Only Assets

- eosin fullres crop
- eosin hires crop
- eosin lowres crop

These are runtime-only and must not leak into final export unless a future requirement changes that rule.

## Implementation Hotspots

Likely files involved:

- `src/app/preprocess/components/PreprocessWorkspace.tsx`
- `src/app/preprocess/components/TissueSelectionPanel.tsx`
- `src/lib/preprocess/tissuePipeline.ts`
- `src/lib/preprocess/spotProjection.ts`
- `src/lib/preprocess/exportBundle.ts`
- `src/lib/preprocess/storage.ts`
- `src/types/preprocess.ts`

Additional helper files may be justified if needed to isolate:

- crop asset generation
- async detection execution
- square spot geometry math
- lowres↔fullres coordinate conversion

## Explicit Non-Goals

- No user-facing asset browser for the three generated crop sizes.
- No automatic detection rerun on chip-size change.
- No circular spot model preserved for backward compatibility in tissue detection.
- No unrelated preprocess-shell redesign.
- No test creation in this pass.

## Future Verification Follow-Up

Although tests are explicitly out of scope for this pass, later validation should cover at least:

- crop pipeline emits all six runtime/export image variants correctly
- scale metadata matches the reference formulas
- square spot side-length export is correct
- chip-size changes avoid rerunning the expensive detection pipeline
- lowres detection correctly maps final spot coordinates back to fullres CSV pixels
- loading overlay and button animation remain synchronized with the real async detection lifecycle
