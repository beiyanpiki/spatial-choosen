# Preprocess Tissue Canvas Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace preprocess tissue spot toggling with a spatial-style canvas editor, restore reliable selection/deletion, and export the final tissue mask as a chip-sized matrix (`50x50` for `50um`, `96x96` for `15um`).

**Architecture:** Keep the preprocess route structure intact, but move tissue editing to region geometry as the manual source of truth. Reuse the existing shared viewport and geometry helpers from the spatial route, add one preprocess-specific helper for mapping regions back to projected spots/matrix rows, and keep the existing preprocess ZIP export surface while adding a matrix CSV artifact inside the ZIP.

**Tech Stack:** Next.js 16, React 19, TypeScript strict mode, Chakra UI, Playwright, polygon-clipping, JSZip.

---

## File map

- Modify: `public/preprocess-chip-configs/50um/manifest.json`
- Modify: `src/types/preprocess.ts`
- Create: `src/lib/preprocess/tissueRegions.ts`
- Modify: `src/lib/preprocess/migrations.ts`
- Modify: `src/lib/preprocess/package.ts`
- Modify: `src/app/preprocess/components/TissueSelectionPanel.tsx`
- Modify: `src/app/preprocess/components/PreprocessWorkspace.tsx`
- Modify: `src/lib/preprocess/exportBundle.ts`
- Modify: `tests/e2e/preprocess-chipconfig.spec.ts`
- Modify: `tests/e2e/preprocess-spot-rendering.spec.ts`
- Modify: `tests/e2e/preprocess-tissue-auto.spec.ts`
- Modify: `tests/e2e/preprocess-tissue-edit.spec.ts`
- Modify: `tests/e2e/preprocess-export.spec.ts`

## Implementation notes before starting

- Work in a dedicated worktree before touching code.
- Do not refactor `src/app/spatial/page.tsx` into shared components for this change.
- The clean derivation rule for final spot selection is:
  - if `tissueSelection.regions.length > 0`, derive `selectedSpotIds` from those regions;
  - otherwise, fall back to `autoSelectedSpotIds`.
- Keep `Run auto-selection` as-is conceptually. It still computes the base mask, but manual region editing becomes authoritative once regions exist.
- Add `tissue_matrix.csv` to the existing ZIP export instead of introducing a new top-level export mode.

### Task 1: Lock preprocess chip geometry to the requested matrix sizes

**Files:**
- Modify: `public/preprocess-chip-configs/50um/manifest.json`
- Modify: `tests/e2e/preprocess-chipconfig.spec.ts`
- Modify: `tests/e2e/preprocess-spot-rendering.spec.ts`
- Modify: `tests/e2e/preprocess-tissue-auto.spec.ts`

- [ ] **Step 1: Write the failing tests for the new 50um grid size**

Update the existing Playwright assertions so `50um` expects `2500` spots instead of `4096`, and update seeded 50um fixtures to use a `50 x 50` grid.

```ts
// tests/e2e/preprocess-chipconfig.spec.ts
test('selecting 50um projects 2500 spots', async ({ page }) => {
  await seedProjectToChipReady(page);

  await page.getByTestId('chipconfig-select').selectOption('50um');
  await expect(page.getByTestId('chipconfig-spot-count')).toHaveText('2500');
  await expect(page.getByTestId('preprocess-step-tissue')).toBeEnabled();
});

// tests/e2e/preprocess-spot-rendering.spec.ts
const grid = chip === '50um' ? 50 : 96;
const totalSpots = grid * grid;
const row = Math.floor(i / grid);
const col = i % grid;
```

- [ ] **Step 2: Run the chip-config test to verify it fails**

Run: `npm run test:e2e -- tests/e2e/preprocess-chipconfig.spec.ts --grep "selecting 50um projects 2500 spots"`

Expected: FAIL because the current 50um manifest still projects `4096` spots.

- [ ] **Step 3: Update the manifest and 50um test fixtures**

Change the shipped preprocess 50um manifest to `50 x 50`, then make every hard-coded 50um test fixture derive its row/column math from `grid = 50` instead of `64`.

```json
// public/preprocess-chip-configs/50um/manifest.json
{
  "id": "50um",
  "label": "Square grid 50um",
  "gridRows": 50,
  "gridCols": 50,
  "spotDiameter": 50,
  "spotGap": 50,
  "barcodeTemplatePath": "/preprocess-chip-configs/50um/tissue_positions.csv",
  "tissuePositionsPath": "/preprocess-chip-configs/50um/tissue_positions.csv"
}
```

```ts
// tests/e2e/preprocess-tissue-auto.spec.ts
const grid = 50;
canvas.width = grid;
canvas.height = grid;
context.fillRect(0, 0, grid, grid);

const projectedSpots = Array.from({ length: grid * grid }, (_, index) => {
  const row = Math.floor(index / grid) + 1;
  const col = (index % grid) + 1;
  return {
    id: `50um-${String(row).padStart(3, '0')}-${String(col).padStart(3, '0')}`,
    barcode: `50um-${String(row).padStart(3, '0')}-${String(col).padStart(3, '0')}`,
    arrayRow: row,
    arrayCol: col,
    x: (col - 0.5) / grid,
    y: (row - 0.5) / grid,
    diameterX: 0.012,
    diameterY: 0.012,
  };
});
```

- [ ] **Step 4: Run the grid-size regression tests to verify they pass**

Run: `npm run test:e2e -- tests/e2e/preprocess-chipconfig.spec.ts tests/e2e/preprocess-spot-rendering.spec.ts tests/e2e/preprocess-tissue-auto.spec.ts`

Expected: PASS, with 50um-specific assertions now reporting `2500` spots and 15um staying `9216`.

- [ ] **Step 5: Commit the geometry baseline change**

```bash
git add public/preprocess-chip-configs/50um/manifest.json tests/e2e/preprocess-chipconfig.spec.ts tests/e2e/preprocess-spot-rendering.spec.ts tests/e2e/preprocess-tissue-auto.spec.ts
git commit -m "fix: align preprocess 50um grid with export target"
```

### Task 2: Introduce preprocess tissue region primitives and persistence support

**Files:**
- Modify: `src/types/preprocess.ts`
- Create: `src/lib/preprocess/tissueRegions.ts`
- Modify: `src/lib/preprocess/migrations.ts`
- Modify: `src/lib/preprocess/package.ts`
- Modify: `tests/e2e/preprocess-tissue-edit.spec.ts`

- [ ] **Step 1: Write the failing region-editing test**

Replace the current spot-add/remove happy-path test with a region-oriented workflow: draw one region, verify it appears in the tissue sidebar, select it, then delete it.

```ts
test('draw and delete a tissue region on the canvas', async ({ page }) => {
  await seedProjectToTissueEditing(page);

  await page.getByTestId('tissue-tool-draw').click();
  const stage = page.getByTestId('tissue-stage-canvas');
  const box = await stage.boundingBox();
  if (!box) throw new Error('Missing tissue-stage-canvas bounds');

  await page.mouse.move(box.x + box.width * 0.20, box.y + box.height * 0.20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.20);
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55);
  await page.mouse.move(box.x + box.width * 0.20, box.y + box.height * 0.55);
  await page.mouse.up();

  await expect(page.getByTestId('tissue-region-row')).toHaveCount(1);
  await expect(page.getByTestId('tissue-selected-count')).not.toHaveText('0');

  await page.getByTestId('tissue-tool-edit').click();
  await page.getByTestId('tissue-region-row').first().click();
  await page.getByTestId('tissue-delete-selected').click();
  await expect(page.getByTestId('tissue-region-row')).toHaveCount(0);
});
```

- [ ] **Step 2: Run the tissue-edit test to verify it fails**

Run: `npm run test:e2e -- tests/e2e/preprocess-tissue-edit.spec.ts --grep "draw and delete a tissue region on the canvas"`

Expected: FAIL because the current preprocess tissue panel has no draw/edit/delete region workflow or `tissue-region-row` / `tissue-delete-selected` controls.

- [ ] **Step 3: Add region types and helper functions before wiring UI**

Extend preprocess tissue regions to support hole-preserving paths, then add a preprocess-specific helper module for converting regions into final selected spots.

```ts
// src/types/preprocess.ts
export type TissueRegion = {
  id: string;
  label: string;
  color: string;
  points: PreprocessPoint[];
  paths?: PreprocessPoint[][];
};
```

```ts
// src/lib/preprocess/tissueRegions.ts
import { regionIntersectsRect } from '@/lib/geometry';
import type { Region } from '@/types/project';
import type { ProjectedSpot, TissueRegion } from '@/types/preprocess';

export function normalizeTissueRegion(region: TissueRegion): TissueRegion {
  return {
    ...region,
    paths: region.paths?.length ? region.paths : [region.points],
  };
}

export function deriveSelectedSpotIdsFromRegions(regions: TissueRegion[], projectedSpots: ProjectedSpot[]) {
  if (regions.length === 0) return [];
  return projectedSpots
    .filter((spot) => {
      const rect = {
        x: spot.x - spot.diameterX / 2,
        y: spot.y - spot.diameterY / 2,
        width: spot.diameterX,
        height: spot.diameterY,
      };
      return regions.some((region) => {
        const geometryRegion: Region = {
          id: region.id,
          label: 0,
          color: region.color,
          points: region.points,
          paths: normalizeTissueRegion(region).paths,
        };
        return regionIntersectsRect(geometryRegion, rect);
      });
    })
    .map((spot) => spot.id);
}

export function buildSelectedCountSummary(selectedIds: string[], totalSpots: number) {
  const selectedCount = selectedIds.length;
  const selectedPercent = totalSpots > 0 ? (selectedCount / totalSpots) * 100 : 0;
  return {
    selectedCount,
    selectedPercent,
    maskCoverage: selectedPercent,
  };
}
```

- [ ] **Step 4: Make migrations and package validation understand region paths**

Normalize older stored regions to `paths ?? [points]`, and allow packaged preprocess projects to round-trip the new optional `paths` field.

```ts
// src/lib/preprocess/migrations.ts
return {
  ...project,
  storageVersion: PREPROCESS_STORAGE_SCHEMA_VERSION,
  tissueSelection: {
    ...project.tissueSelection,
    forcedInSpotIds: project.tissueSelection.forcedInSpotIds ?? [],
    forcedOutSpotIds: project.tissueSelection.forcedOutSpotIds ?? [],
    overrideNotice: project.tissueSelection.overrideNotice ?? null,
    autoSelectedSpotIds: project.tissueSelection.autoSelectedSpotIds ?? [],
    regions: (project.tissueSelection.regions ?? []).map((region) => ({
      ...region,
      paths: region.paths?.length ? region.paths : [region.points],
    })),
  },
};
```

```ts
// src/lib/preprocess/package.ts
if (Array.isArray(item.paths)) {
  for (const [pathIndex, ring] of item.paths.entries()) {
    assertArray(ring, `tissueSelection.regions[${index}].paths[${pathIndex}]`);
    for (const [pointIndex, point] of ring.entries()) {
      assertPreprocessPoint(point, `tissueSelection.regions[${index}].paths[${pathIndex}][${pointIndex}]`);
    }
  }
}
```

- [ ] **Step 5: Run the tissue-edit test again to confirm it still fails for the right reason**

Run: `npm run test:e2e -- tests/e2e/preprocess-tissue-edit.spec.ts --grep "draw and delete a tissue region on the canvas"`

Expected: FAIL, but now because the UI is still spot-based rather than because the data model cannot represent regions.

- [ ] **Step 6: Commit the region-model groundwork**

```bash
git add src/types/preprocess.ts src/lib/preprocess/tissueRegions.ts src/lib/preprocess/migrations.ts src/lib/preprocess/package.ts tests/e2e/preprocess-tissue-edit.spec.ts
git commit -m "refactor: add preprocess tissue region primitives"
```

### Task 3: Rebuild the tissue panel as a spatial-style canvas editor

**Files:**
- Modify: `src/app/preprocess/components/TissueSelectionPanel.tsx`
- Modify: `src/app/preprocess/components/PreprocessWorkspace.tsx`
- Modify: `tests/e2e/preprocess-tissue-edit.spec.ts`

- [ ] **Step 1: Add one more failing test for erase behavior**

Add a second Playwright case that draws a region, selects it, uses `Punch Out`, and verifies the final selected count drops.

```ts
test('punch out removes tissue area from the selected region', async ({ page }) => {
  await seedProjectToTissueEditing(page);

  const stage = page.getByTestId('tissue-stage-canvas');
  const box = await stage.boundingBox();
  if (!box) throw new Error('Missing tissue-stage-canvas bounds');

  await page.getByTestId('tissue-tool-draw').click();
  await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.18);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.18);
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75);
  await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.75);
  await page.mouse.up();

  const before = Number(await page.getByTestId('tissue-selected-count').innerText());

  await page.getByTestId('tissue-tool-edit').click();
  await page.getByTestId('tissue-region-row').first().click();
  await page.getByTestId('tissue-tool-erase').click();
  await page.mouse.move(box.x + box.width * 0.40, box.y + box.height * 0.40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.40);
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55);
  await page.mouse.move(box.x + box.width * 0.40, box.y + box.height * 0.55);
  await page.mouse.up();

  const after = Number(await page.getByTestId('tissue-selected-count').innerText());
  expect(after).toBeLessThan(before);
});
```

- [ ] **Step 2: Run the tissue-edit file to verify both interaction tests fail**

Run: `npm run test:e2e -- tests/e2e/preprocess-tissue-edit.spec.ts`

Expected: FAIL because the current preprocess panel still exposes `inspect/add/remove` spot toggles instead of `draw/edit/erase` region editing.

- [ ] **Step 3: Replace the panel with a canvas editor that mirrors spatial behavior**

Port the core spatial interaction pattern into `TissueSelectionPanel.tsx`: viewport refs, normalized pointer conversion, `draw/edit/erase` tool state, selected-region state, delete-selected, and punch-out.

```tsx
// src/app/preprocess/components/TissueSelectionPanel.tsx
const [tool, setTool] = useState<'draw' | 'edit' | 'erase'>('edit');
const [selectedRegionIds, setSelectedRegionIds] = useState<string[]>([]);
const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);
const [zoom, setZoom] = useState(1);
const [pan, setPan] = useState({ x: 0, y: 0 });
const [isDrawing, setIsDrawing] = useState(false);
const [currentPoints, setCurrentPoints] = useState<PreprocessPoint[]>([]);

const canvasRef = useRef<HTMLCanvasElement | null>(null);
const hostRef = useRef<HTMLDivElement | null>(null);
const loadedImageRef = useRef<HTMLImageElement | null>(null);
const pathRef = useRef<PreprocessPoint[]>([]);

const deleteSelectedRegions = () => {
  if (selectedRegionIds.length === 0) return;
  const remove = new Set(selectedRegionIds);
  onRegionsChange(regions.filter((region) => !remove.has(region.id)));
  setSelectedRegionIds([]);
  setSelectionAnchor(null);
};
```

```tsx
const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
  const point = screenToImage(event);
  if (!point) return;

  if (tool === 'edit') {
    const hit = findRegionAtPoint(point);
    if (hit) {
      const hitIndex = regions.findIndex((region) => region.id === hit.id);
      selectRegionByIndex(hitIndex, {
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      });
      return;
    }
    panStartRef.current = { x: event.clientX, y: event.clientY };
    setIsPanning(true);
    return;
  }

  pathRef.current = [point];
  setCurrentPoints([point]);
  setIsDrawing(true);
};
```

- [ ] **Step 4: Rewire workspace updates so region edits derive `selectedSpotIds`**

Pass `regions`, `selectedCount`, and a new `onRegionsChange(...)` callback into the panel. In `PreprocessWorkspace.tsx`, derive final selected spots from regions when they exist, otherwise fall back to the auto-selection mask.

```tsx
// src/app/preprocess/components/PreprocessWorkspace.tsx
const projectedSpots = project.chipConfig.projectedSpots ?? [];

const applyRegionSelection = (nextRegions: TissueRegion[]) => {
  onProjectMutate((current) => {
    const finalSelectedSpotIds = nextRegions.length > 0
      ? deriveSelectedSpotIdsFromRegions(nextRegions, current.chipConfig.projectedSpots ?? [])
      : current.tissueSelection.autoSelectedSpotIds;

    return {
      ...current,
      tissueSelection: {
        ...current.tissueSelection,
        mode: 'polygon',
        regions: nextRegions,
        selectedRegionId: nextRegions[0]?.id ?? null,
        selectedSpotIds: finalSelectedSpotIds,
        paritySummary: buildSelectedCountSummary(finalSelectedSpotIds, (current.chipConfig.projectedSpots ?? []).length),
        overrideNotice: null,
        status: 'complete',
        isStale: false,
        updatedAt: new Date().toISOString(),
        warning: null,
        error: null,
      },
      exportState: {
        ...current.exportState,
        status: 'stale',
        isStale: true,
        updatedAt: new Date().toISOString(),
        error: null,
      },
    };
  });
};
```

- [ ] **Step 5: Run the tissue-edit test file to verify the new canvas editor passes**

Run: `npm run test:e2e -- tests/e2e/preprocess-tissue-edit.spec.ts`

Expected: PASS, with visible region rows, delete-selected control, and punch-out reducing the derived selected-spot count.

- [ ] **Step 6: Commit the canvas-editor rewrite**

```bash
git add src/app/preprocess/components/TissueSelectionPanel.tsx src/app/preprocess/components/PreprocessWorkspace.tsx tests/e2e/preprocess-tissue-edit.spec.ts
git commit -m "feat: add spatial-style tissue canvas editor"
```

### Task 4: Export the final chip-sized matrix and finish regression coverage

**Files:**
- Modify: `src/lib/preprocess/exportBundle.ts`
- Modify: `tests/e2e/preprocess-export.spec.ts`
- Modify: `tests/e2e/preprocess-tissue-auto.spec.ts`

- [ ] **Step 1: Write the failing export-matrix test**

Extend the ZIP export spec so it expects a new `tissue_matrix.csv` entry and verifies the exported matrix dimensions for a 50um project.

```ts
test('export includes the chip-sized tissue matrix csv', async ({ page }) => {
  await seedProjectToExportReady(page);

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-download-zip').click();
  const download = await downloadPromise;
  const filePath = await download.path();
  if (!filePath) throw new Error('Missing downloaded zip path');

  const bytes = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(bytes);
  const matrixEntry = zip.file('tissue_matrix.csv');
  if (!matrixEntry) throw new Error('Missing tissue_matrix.csv in export zip');

  const matrixCsv = await matrixEntry.async('text');
  const rows = matrixCsv.trim().split(/\r?\n/);
  expect(rows).toHaveLength(50);
  expect(rows[0].split(',')).toHaveLength(50);
});
```

- [ ] **Step 2: Run the export test to verify it fails**

Run: `npm run test:e2e -- tests/e2e/preprocess-export.spec.ts --grep "export includes the chip-sized tissue matrix csv"`

Expected: FAIL because the current ZIP export only writes `tissue_position.csv` and does not produce a chip-sized matrix artifact.

- [ ] **Step 3: Add matrix CSV generation to preprocess export**

Build a matrix serializer from `chipConfig.rows`, `chipConfig.columns`, and `selectedSpotIds`, then add `tissue_matrix.csv` to the ZIP.

```ts
// src/lib/preprocess/exportBundle.ts
const toMatrixCsv = (projectedSpots: ProjectedSpot[], selectedSpotIds: Set<string>, rows: number, cols: number) => {
  const matrix = Array.from({ length: rows }, () => Array.from({ length: cols }, () => '0'));

  for (const spot of projectedSpots) {
    const rowIndex = spot.arrayRow - 1;
    const colIndex = spot.arrayCol - 1;
    if (rowIndex < 0 || rowIndex >= rows || colIndex < 0 || colIndex >= cols) continue;
    matrix[rowIndex][colIndex] = selectedSpotIds.has(spot.id) ? '1' : '0';
  }

  return `${matrix.map((row) => row.join(',')).join('\n')}\n`;
};

// inside exportPreprocessZip(...)
const rows = project.chipConfig.rows;
const cols = project.chipConfig.columns;
if (!rows || !cols) {
  throw new Error('Chip grid dimensions missing. Complete chip config before export.');
}

zip.file('tissue_matrix.csv', toMatrixCsv(projectedSpots, selectedSpotIds, rows, cols));
```

- [ ] **Step 4: Run focused export + auto-selection regressions**

Run: `npm run test:e2e -- tests/e2e/preprocess-export.spec.ts tests/e2e/preprocess-tissue-auto.spec.ts`

Expected: PASS, with ZIP export containing `tissue_matrix.csv` and tissue auto-selection still reporting stable summary values.

- [ ] **Step 5: Run lint, build, and the full preprocess regression slice**

Run:

```bash
npm run lint -- src/app/preprocess/components/TissueSelectionPanel.tsx src/app/preprocess/components/PreprocessWorkspace.tsx src/lib/preprocess/tissueRegions.ts src/lib/preprocess/exportBundle.ts src/types/preprocess.ts src/lib/preprocess/migrations.ts src/lib/preprocess/package.ts
npm run build
npm run test:e2e -- tests/e2e/preprocess-chipconfig.spec.ts tests/e2e/preprocess-spot-rendering.spec.ts tests/e2e/preprocess-tissue-auto.spec.ts tests/e2e/preprocess-tissue-edit.spec.ts tests/e2e/preprocess-export.spec.ts
```

Expected: all commands exit `0`.

- [ ] **Step 6: Manual QA the full requested workflow**

Run the app locally and verify the real feature end-to-end:

```bash
npm run dev
```

Manual QA checklist:

1. Create a preprocess project and advance to Tissue Selection.
2. Select `50um`, confirm the chip summary reflects `50 x 50`.
3. Run auto-selection, then draw a manual tissue region.
4. Switch to edit mode, select the region, and delete it.
5. Draw another region, use Punch Out, and confirm selected count drops.
6. Export the ZIP and inspect `tissue_matrix.csv` to confirm `50` rows × `50` columns.
7. Repeat the export check with a `15um` project and confirm `96` rows × `96` columns.

- [ ] **Step 7: Commit the export + regression completion**

```bash
git add src/lib/preprocess/exportBundle.ts tests/e2e/preprocess-export.spec.ts tests/e2e/preprocess-tissue-auto.spec.ts
git commit -m "feat: export preprocess tissue matrix"
```

## Self-review checklist

- Spec coverage:
  - canvas parity (`Task 3`) ✅
  - selection/deletion parity (`Task 3`) ✅
  - punch-out erase (`Task 3`) ✅
  - `50x50` / `96x96` export target (`Task 1`, `Task 4`) ✅
  - export matrix artifact (`Task 4`) ✅
- Placeholder scan:
  - no `TODO` / `TBD` markers
  - each task includes exact files, commands, and code snippets
- Type consistency:
  - `TissueRegion.paths` added before any later task uses it
  - `deriveSelectedSpotIdsFromRegions(...)` introduced before workspace wiring references it
