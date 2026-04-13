import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectedSpot } from '@/types/preprocess';
import { runTissueAutoSelection } from './tissuePipeline';

const PROJECTED_SPOTS: ProjectedSpot[] = [
  {
    id: 'spot-a',
    barcode: 'spot-a',
    arrayRow: 0,
    arrayCol: 0,
    x: 0.15,
    y: 0.15,
    width: 0.1,
    height: 0.1,
    diameterX: 0.1,
    diameterY: 0.1,
  },
  {
    id: 'spot-b',
    barcode: 'spot-b',
    arrayRow: 0,
    arrayCol: 1,
    x: 0.28,
    y: 0.15,
    width: 0.1,
    height: 0.1,
    diameterX: 0.1,
    diameterY: 0.1,
  },
  {
    id: 'spot-c',
    barcode: 'spot-c',
    arrayRow: 4,
    arrayCol: 4,
    x: 0.75,
    y: 0.75,
    width: 0.1,
    height: 0.1,
    diameterX: 0.1,
    diameterY: 0.1,
  },
];

const installImageDataStub = (activeSpots: string[]) => {
  const activeSet = new Set(activeSpots);
  const width = 10;
  const height = 10;
  const imageData = new Uint8ClampedArray(width * height * 4).fill(255);

  for (const spot of PROJECTED_SPOTS) {
    if (!activeSet.has(spot.id)) {
      continue;
    }

    const startX = Math.floor((spot.x - spot.diameterX / 2) * width);
    const endX = Math.ceil((spot.x + spot.diameterX / 2) * width);
    const startY = Math.floor((spot.y - spot.diameterY / 2) * height);
    const endY = Math.ceil((spot.y + spot.diameterY / 2) * height);

    for (let py = startY; py < endY; py += 1) {
      for (let px = startX; px < endX; px += 1) {
        const offset = (py * width + px) * 4;
        imageData[offset] = 0;
        imageData[offset + 1] = 0;
        imageData[offset + 2] = 0;
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
  it('removes isolated auto-detected spots with the existing cleanup params', async () => {
    installImageDataStub(['spot-a', 'spot-b', 'spot-c']);

    const result = await runTissueAutoSelection({
      eosinLowresCropDataUrl: 'data:image/png;base64,stub',
      cropWidth: 100,
      cropHeight: 100,
      tissueLowresScaleFactor: 0.1,
      projectedSpots: PROJECTED_SPOTS,
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
  });
});
