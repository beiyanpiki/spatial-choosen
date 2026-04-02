# LIBRARY LAYER GUIDE

## OVERVIEW
`src/lib/` contains browser-only support code for storage, bundle decoding, chip layout math, import/export packaging, and label colors.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Project persistence / migration | `projects.ts` | Metadata in `localStorage`; images + matrix blobs in IndexedDB |
| Bundle decoding | `bundleDecoder.ts` | Base64 helpers, coord extraction, `.npy` parsing |
| Chip type + spot layout math | `chip.ts` | Normalized rects and generated `Spot[][]` |
| Portable project packaging | `projectPackage.ts` | Versioned `.spatialproj` import/export |
| Label colors | `colors.ts` | Stable palette lookup by label number |

## CONVENTIONS
- Guard browser-only code with `typeof window !== 'undefined'` checks or the local `isBrowser()` helpers.
- Keep large binary payloads out of `localStorage`; only project metadata belongs there.
- Copy typed-array-backed matrix data into a fresh `ArrayBuffer` before storing/exporting when shared buffers are possible.
- `ChipRect` and `Spot` values are normalized against image size; callers scale them for display.
- Bundle decoder tolerates multiple coord wrapper shapes (`hull_position`, `hullPosition`, `hull`) and even the `heigth` typo.

## ANTI-PATTERNS
- Do not return raw pixel-space rectangles from `normalizeChipRect()` or `buildSpotMatrix()`.
- Do not skip package version checks in `deserializeProject()`; format evolution is explicit.
- Do not write image data inline into exported metadata-only structures.
- Do not assume server compatibility; these helpers rely on browser APIs like `indexedDB`, `Blob`, `File`, `atob`, and `btoa`.

## NOTES
- `projects.ts` still contains migration logic for older inline-storage records.
- `bundleDecoder.ts` does heavy lifting for both preview images and matrix ingestion; any bundle-format change usually starts there.
