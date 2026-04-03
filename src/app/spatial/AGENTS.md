# SPATIAL ROUTE GUIDE

## OVERVIEW
`src/app/spatial/page.tsx` is a single-file annotation workspace: canvas rendering, geometry, selection state, undo/redo, chip overlays, and export flows all live here.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Project load + initial persistence hook-up | `page.tsx` `useEffect` + `persist()` | Reads project by `project_id`, writes via `upsertProject()` |
| Region hit-testing / geometry | `pointInRing`, `ringIntersectsRect`, `regionIntersectsRect` | Normalized coordinates; supports holes |
| Drawing / erase interactions | `handlePointerDown/Move/Up`, `commitRegion`, `punchOut` | `punchOut()` uses `polygon-clipping` |
| Undo / redo | `handleUndo`, `handleRedo` | Keeps up to 50 snapshots |
| Spot overlay + matrix masking | `matrixMask`, `spotAssignments`, draw loop | Matrix zeroes suppress spot rendering |
| Export flows | `handleExportProject`, `handleExportResults` | `.spatialproj` + CSV |
| Sidebar controls | lower half of component render | Chip config, region list, tool buttons |

## CONVENTIONS
- Region and chip coordinates are image-relative (`0..1`), not pixels.
- `Region.paths` uses ring order: first ring outer boundary, remaining rings holes; fall back to `points` for legacy single-ring data.
- Use `persist()` for project mutations that should update UI, history, and local storage together.
- Selection is multi-mode: plain click replace, Ctrl/Cmd toggle, Shift range-select.
- Middle mouse or empty-space drag pans; wheel zoom anchors around pointer when possible.

## ANTI-PATTERNS
- Do not mutate `project.regions` in place; most logic assumes immutable updates before calling `persist()`.
- Do not switch helper math to pixel coordinates; many intersections and exports assume normalized space.
- Do not bypass `matrixMask` when rendering or exporting spots; zero values are treated as masked-out cells.
- Do not make direct `setProject()` edits for persistent changes unless you also reason through undo/redo and `upsertProject()` behavior.

## NOTES
- This file is the repo’s main complexity hotspot despite the small directory size.
- `polygon-clipping.difference()` may split one selected region into multiple output regions; the code preserves the original id for the first fragment and suffixes later fragments.
- Chip type can be user-adjustable only when the project was not locked by bundle metadata.
