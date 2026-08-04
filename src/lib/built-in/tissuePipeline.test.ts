import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectedSpot } from '@/types/built-in';
import type { ChipTemplateEntry } from './chipConfigs';
import { projectSpotsForCrop } from './spotProjection';
import { runTissueAutoSelection } from './tissuePipeline';

type Rgb = readonly [number, number, number];

const createProjectedSpot = (args: {
  id: string;
  arrayRow: number;
  arrayCol: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
}) => {
  const width = args.width ?? 0.1;
  const height = args.height ?? 0.1;

  return {
    id: args.id,
    barcode: args.id,
    arrayRow: args.arrayRow,
    arrayCol: args.arrayCol,
    x: args.x,
    y: args.y,
    width,
    height,
    diameterX: width,
    diameterY: height,
  } satisfies ProjectedSpot;
};

const FIFTEEN_UM_PROJECTED_SPOTS: ProjectedSpot[] = [
  createProjectedSpot({ id: 'spot-a', arrayRow: 1, arrayCol: 1, x: 0.15, y: 0.15 }),
  createProjectedSpot({ id: 'spot-b', arrayRow: 1, arrayCol: 2, x: 0.28, y: 0.15 }),
  createProjectedSpot({ id: 'spot-c', arrayRow: 5, arrayCol: 5, x: 0.75, y: 0.75 }),
];

const FIFTY_UM_PROJECTED_SPOTS: ProjectedSpot[] = [
  createProjectedSpot({ id: 'spot-a', arrayRow: 1, arrayCol: 1, x: 0.2, y: 0.2 }),
  createProjectedSpot({ id: 'spot-b', arrayRow: 3, arrayCol: 4, x: 0.8, y: 0.8, width: 0.08, height: 0.08 }),
];

const createLowConfidenceProjectedSpots = () => {
  const spots: ProjectedSpot[] = [];

  for (let row = 1; row <= 11; row += 1) {
    for (let col = 1; col <= 10; col += 1) {
      spots.push(
        createProjectedSpot({
          id: `spot-${row}-${col}`,
          arrayRow: row,
          arrayCol: col,
          x: 0.05 + (col - 1) * 0.08,
          y: 0.05 + (row - 1) * 0.08,
          width: 0.04,
          height: 0.04,
        }),
      );
    }
  }

  return spots;
};

const ZERO_BASED_PROJECTED_SPOTS: ProjectedSpot[] = [
  createProjectedSpot({ id: 'spot-a', arrayRow: 0, arrayCol: 0, x: 0.2, y: 0.2 }),
  createProjectedSpot({ id: 'spot-b', arrayRow: 0, arrayCol: 1, x: 0.35, y: 0.2 }),
  createProjectedSpot({ id: 'spot-c', arrayRow: 2, arrayCol: 3, x: 0.75, y: 0.75 }),
];

const PROJECTED_SPOT_CHIP = {
  id: '15um',
  label: 'Test chip',
  gridRows: 2,
  gridCols: 2,
  spotDiameter: 10,
  spotGap: 4,
  barcodeTemplatePath: '/unused/template.csv',
  tissuePositionsPath: '/unused/tissue.csv',
} as const;

const PROJECTED_SPOT_TEMPLATE_ENTRIES: ChipTemplateEntry[] = [
  {
    barcode: 'spot-a',
    arrayRow: 1,
    arrayCol: 1,
  },
  {
    barcode: 'spot-b',
    arrayRow: 1,
    arrayCol: 2,
  },
  {
    barcode: 'spot-c',
    arrayRow: 2,
    arrayCol: 1,
  },
  {
    barcode: 'spot-d',
    arrayRow: 2,
    arrayCol: 2,
  },
];

const installImageDataStub = (args: {
  projectedSpots: ProjectedSpot[];
  colorsBySpotId: Record<string, Rgb>;
  width?: number;
  height?: number;
}) => {
  const width = args.width ?? 100;
  const height = args.height ?? 100;
  const imageData = new Uint8ClampedArray(width * height * 4).fill(255);

  for (const spot of args.projectedSpots) {
    const rgb = args.colorsBySpotId[spot.id];
    if (!rgb) {
      continue;
    }

    const startX = Math.floor((spot.x - spot.diameterX / 2) * width);
    const endX = Math.ceil((spot.x + spot.diameterX / 2) * width);
    const startY = Math.floor((spot.y - spot.diameterY / 2) * height);
    const endY = Math.ceil((spot.y + spot.diameterY / 2) * height);

    for (let py = startY; py < endY; py += 1) {
      for (let px = startX; px < endX; px += 1) {
        const offset = (py * width + px) * 4;
        imageData[offset] = rgb[0];
        imageData[offset + 1] = rgb[1];
        imageData[offset + 2] = rgb[2];
        imageData[offset + 3] = 255;
      }
    }
  }

  class MockImage {
    naturalWidth = width;
    naturalHeight = height;
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }

  const context = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: imageData, width, height })),
  };

  vi.stubGlobal('window', { Image: MockImage });
  vi.stubGlobal('document', {
    createElement: vi.fn(() => ({
      width,
      height,
      getContext: vi.fn(() => context),
    })),
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runTissueAutoSelection', () => {
  it('keeps matrix shape and selection stable for projected crop spots', async () => {
    const projectedSpots = projectSpotsForCrop({
      chip: PROJECTED_SPOT_CHIP,
      templateEntries: PROJECTED_SPOT_TEMPLATE_ENTRIES,
      cropWidth: 400,
      cropHeight: 400,
    });

    expect(projectedSpots).toEqual([
      {
        id: 'spot-a',
        barcode: 'spot-a',
        arrayRow: 1,
        arrayCol: 1,
        x: 0.28125,
        y: 0.28125,
        width: 0.3125,
        height: 0.3125,
        diameterX: 0.3125,
        diameterY: 0.3125,
      },
      {
        id: 'spot-b',
        barcode: 'spot-b',
        arrayRow: 1,
        arrayCol: 2,
        x: 0.71875,
        y: 0.28125,
        width: 0.3125,
        height: 0.3125,
        diameterX: 0.3125,
        diameterY: 0.3125,
      },
      {
        id: 'spot-c',
        barcode: 'spot-c',
        arrayRow: 2,
        arrayCol: 1,
        x: 0.28125,
        y: 0.71875,
        width: 0.3125,
        height: 0.3125,
        diameterX: 0.3125,
        diameterY: 0.3125,
      },
      {
        id: 'spot-d',
        barcode: 'spot-d',
        arrayRow: 2,
        arrayCol: 2,
        x: 0.71875,
        y: 0.71875,
        width: 0.3125,
        height: 0.3125,
        diameterX: 0.3125,
        diameterY: 0.3125,
      },
    ]);

    installImageDataStub({
      projectedSpots,
      colorsBySpotId: {
        'spot-a': [255, 0, 0],
        'spot-b': [255, 0, 0],
        'spot-c': [80, 80, 80],
        'spot-d': [255, 0, 0],
      },
      width: 400,
      height: 400,
    });

    const result = await runTissueAutoSelection({
      eosinLowresCropDataUrl: 'data:image/png;base64,stub',
      cropWidth: 400,
      cropHeight: 400,
      tissueLowresScaleFactor: 1,
      matrixRows: 2,
      matrixColumns: 2,
      projectedSpots,
      params: {
        thresholdMode: 'raw',
        activationThreshold: 0.5,
        blockThreshold: 10,
        dbscanEps: 0.2,
        dbscanMinSamples: 1,
        minConnectedSpotCount: 1,
      },
    });

    expect(result.selectedIds).toEqual(['spot-a', 'spot-b', 'spot-d']);
    expect(result.matrix.rows).toBe(2);
    expect(result.matrix.columns).toBe(2);
    expect(result.matrix.values).toEqual([1, 1, 0, 1]);
  });

  it('returns distinct raw, gray-max, and gray-min selections from the same RGB fixture and preserves a 96x96 matrix', async () => {
    installImageDataStub({
      projectedSpots: FIFTEEN_UM_PROJECTED_SPOTS,
      colorsBySpotId: {
        'spot-a': [255, 0, 0],
        'spot-b': [200, 0, 200],
        'spot-c': [80, 80, 80],
      },
    });

    const commonArgs = {
      eosinLowresCropDataUrl: 'data:image/png;base64,stub',
      cropWidth: 100,
      cropHeight: 100,
      tissueLowresScaleFactor: 1,
      matrixRows: 96,
      matrixColumns: 96,
      projectedSpots: FIFTEEN_UM_PROJECTED_SPOTS,
      params: {
        activationThreshold: 0.5,
        blockThreshold: 100,
        dbscanEps: 0.2,
        dbscanMinSamples: 1,
        minConnectedSpotCount: 1,
      },
    };

    const rawResult = await runTissueAutoSelection(commonArgs);
    const grayMaxResult = await runTissueAutoSelection({
      ...commonArgs,
      params: {
        ...commonArgs.params,
        thresholdMode: 'gray-max',
      },
    });
    const grayMinResult = await runTissueAutoSelection({
      ...commonArgs,
      params: {
        ...commonArgs.params,
        thresholdMode: 'gray-min',
      },
    });

    expect(rawResult.selectedIds).toEqual(['spot-a', 'spot-b']);
    expect(grayMaxResult.selectedIds).toEqual(['spot-c']);
    expect(grayMinResult.selectedIds).toEqual(['spot-a', 'spot-b', 'spot-c']);

    expect(rawResult.matrix.rows).toBe(96);
    expect(rawResult.matrix.columns).toBe(96);
    expect(rawResult.matrix.values.length).toBe(96 * 96);

    expect(grayMaxResult.matrix.rows).toBe(96);
    expect(grayMaxResult.matrix.columns).toBe(96);
    expect(grayMaxResult.matrix.values.length).toBe(96 * 96);

    expect(grayMinResult.matrix.rows).toBe(96);
    expect(grayMinResult.matrix.columns).toBe(96);
    expect(grayMinResult.matrix.values.length).toBe(96 * 96);
  });

  it('returns a 64x64 matrix for supported 50um input', async () => {
    installImageDataStub({
      projectedSpots: FIFTY_UM_PROJECTED_SPOTS,
      colorsBySpotId: {
        'spot-a': [255, 0, 0],
      },
    });

    const result = await runTissueAutoSelection({
      eosinLowresCropDataUrl: 'data:image/png;base64,stub',
      cropWidth: 100,
      cropHeight: 100,
      tissueLowresScaleFactor: 1,
      matrixRows: 64,
      matrixColumns: 64,
      projectedSpots: FIFTY_UM_PROJECTED_SPOTS,
      params: {
        thresholdMode: 'raw',
        activationThreshold: 0.5,
        blockThreshold: 100,
        dbscanEps: 0.2,
        dbscanMinSamples: 1,
        minConnectedSpotCount: 1,
      },
    });

    expect(result.selectedIds).toEqual(['spot-a']);
    expect(result.matrix.rows).toBe(64);
    expect(result.matrix.columns).toBe(64);
    expect(result.matrix.values.length).toBe(64 * 64);
  });

  it('removes isolated auto-detected spots with the existing cleanup params', async () => {
    installImageDataStub({
      projectedSpots: FIFTEEN_UM_PROJECTED_SPOTS,
      colorsBySpotId: {
        'spot-a': [255, 0, 0],
        'spot-b': [255, 0, 0],
        'spot-c': [255, 0, 0],
      },
    });

    const result = await runTissueAutoSelection({
      eosinLowresCropDataUrl: 'data:image/png;base64,stub',
      cropWidth: 100,
      cropHeight: 100,
      tissueLowresScaleFactor: 1,
      matrixRows: 96,
      matrixColumns: 96,
      projectedSpots: FIFTEEN_UM_PROJECTED_SPOTS,
      params: {
        activationThreshold: 0.5,
        blockThreshold: 10,
        dbscanEps: 0.2,
        dbscanMinSamples: 2,
        minConnectedSpotCount: 2,
      },
    });

    expect(result.selectedIds).toEqual(['spot-a', 'spot-b']);
    expect(result.summary.selectedCount).toBe(2);
    expect(result.matrix.rows).toBe(96);
    expect(result.matrix.columns).toBe(96);
    expect(result.matrix.values.length).toBe(96 * 96);
  });

  it('honors explicit matrix dimensions without needing a boundary sentinel spot', async () => {
    installImageDataStub({
      projectedSpots: FIFTY_UM_PROJECTED_SPOTS,
      colorsBySpotId: {
        'spot-a': [255, 0, 0],
      },
    });

    const result = await runTissueAutoSelection({
      eosinLowresCropDataUrl: 'data:image/png;base64,stub',
      cropWidth: 100,
      cropHeight: 100,
      tissueLowresScaleFactor: 1,
      matrixRows: 64,
      matrixColumns: 64,
      projectedSpots: FIFTY_UM_PROJECTED_SPOTS,
      params: {
        thresholdMode: 'raw',
        activationThreshold: 0.5,
        blockThreshold: 10,
        dbscanEps: 0.2,
        dbscanMinSamples: 1,
        minConnectedSpotCount: 1,
      },
    });

    expect(result.matrix.rows).toBe(64);
    expect(result.matrix.columns).toBe(64);
    expect(result.matrix.values.length).toBe(64 * 64);
    expect(result.matrix.values[0]).toBe(1);
    expect(result.matrix.values[63 * 64 + 63]).toBe(0);
  });

  it('falls back to robust zero-based dimension inference when explicit dimensions are omitted', async () => {
    installImageDataStub({
      projectedSpots: ZERO_BASED_PROJECTED_SPOTS,
      colorsBySpotId: {
        'spot-a': [255, 0, 0],
        'spot-c': [255, 0, 0],
      },
    });

    const result = await runTissueAutoSelection({
      eosinLowresCropDataUrl: 'data:image/png;base64,stub',
      cropWidth: 100,
      cropHeight: 100,
      tissueLowresScaleFactor: 1,
      projectedSpots: ZERO_BASED_PROJECTED_SPOTS,
      params: {
        thresholdMode: 'raw',
        activationThreshold: 0.5,
        blockThreshold: 10,
        dbscanEps: 0.2,
        dbscanMinSamples: 1,
        minConnectedSpotCount: 1,
      },
    });

    expect(result.selectedIds).toEqual(['spot-a', 'spot-c']);
    expect(result.matrix.rows).toBe(3);
    expect(result.matrix.columns).toBe(4);
    expect(result.matrix.values.length).toBe(3 * 4);
    expect(result.matrix.values[0]).toBe(1);
    expect(result.matrix.values[3]).toBe(0);
    expect(result.matrix.values[11]).toBe(1);
  });

  it('keeps warning behavior for empty and low-confidence results', async () => {
    const lowConfidenceSpots = createLowConfidenceProjectedSpots();

    installImageDataStub({
      projectedSpots: lowConfidenceSpots,
      colorsBySpotId: {
        'spot-1-1': [255, 0, 0],
      },
      width: 200,
      height: 200,
    });

    const lowConfidenceResult = await runTissueAutoSelection({
      eosinLowresCropDataUrl: 'data:image/png;base64,stub',
      cropWidth: 200,
      cropHeight: 200,
      tissueLowresScaleFactor: 1,
      matrixRows: 96,
      matrixColumns: 96,
      projectedSpots: lowConfidenceSpots,
      params: {
        thresholdMode: 'raw',
        activationThreshold: 0.5,
        blockThreshold: 10,
        dbscanEps: 0.01,
        dbscanMinSamples: 1,
        minConnectedSpotCount: 1,
      },
    });

    installImageDataStub({
      projectedSpots: lowConfidenceSpots,
      colorsBySpotId: {},
      width: 200,
      height: 200,
    });

    const emptyResult = await runTissueAutoSelection({
      eosinLowresCropDataUrl: 'data:image/png;base64,stub',
      cropWidth: 200,
      cropHeight: 200,
      tissueLowresScaleFactor: 1,
      matrixRows: 96,
      matrixColumns: 96,
      projectedSpots: lowConfidenceSpots,
      params: {
        thresholdMode: 'raw',
        activationThreshold: 0.5,
        blockThreshold: 10,
        dbscanEps: 0.01,
        dbscanMinSamples: 1,
        minConnectedSpotCount: 1,
      },
    });

    expect(lowConfidenceResult.selectedIds).toEqual(['spot-1-1']);
    expect(lowConfidenceResult.warning).toBe('Auto-selection result is empty or low-confidence.');
    expect(lowConfidenceResult.matrix.rows).toBe(96);
    expect(lowConfidenceResult.matrix.columns).toBe(96);
    expect(lowConfidenceResult.matrix.values.length).toBe(96 * 96);

    expect(emptyResult.selectedIds).toEqual([]);
    expect(emptyResult.warning).toBe('Auto-selection result is empty or low-confidence.');
    expect(emptyResult.matrix.rows).toBe(96);
    expect(emptyResult.matrix.columns).toBe(96);
    expect(emptyResult.matrix.values.length).toBe(96 * 96);
  });
});
