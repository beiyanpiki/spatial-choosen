import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { theme } from '../../../theme';
import type {
  AlignmentControlPoint,
  AlignmentSlice,
  PreprocessSourceImage,
} from '../../../types/preprocess';
import { AlignmentPanel } from './AlignmentPanel';

const loadOpenCvMock = vi.fn();
const { solveAffineAlignmentMock } = vi.hoisted(() => ({
  solveAffineAlignmentMock: vi.fn(),
}));

vi.mock('@/lib/preprocess/alignment', async () => {
  const actual = await vi.importActual<typeof import('@/lib/preprocess/alignment')>(
    '@/lib/preprocess/alignment',
  );

  return {
    ...actual,
    solveAffineAlignment: (...args: Parameters<typeof actual.solveAffineAlignment>) =>
      solveAffineAlignmentMock(...args),
  };
});

vi.mock('@/lib/preprocess/loadOpenCv', () => ({
  loadOpenCv: (...args: unknown[]) => loadOpenCvMock(...args),
}));

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
  }

  vi.stubGlobal('ResizeObserver', ResizeObserverMock);

  Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return 640;
    },
  });

  Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return 480;
    },
  });
});

const createOpenCvRuntimeStub = () => {
  class MatStub {
    delete() {}
  }

  return {
    CV_64F: 0,
    Mat: MatStub,
    matFromArray: () => new MatStub(),
    setRNGSeed: vi.fn(),
  };
};

beforeEach(() => {
  loadOpenCvMock.mockReset();
  loadOpenCvMock.mockResolvedValue({ cv: createOpenCvRuntimeStub() });
});

beforeEach(async () => {
  const actual = await vi.importActual<typeof import('@/lib/preprocess/alignment')>(
    '@/lib/preprocess/alignment',
  );

  solveAffineAlignmentMock.mockReset();
  solveAffineAlignmentMock.mockImplementation((
    ...args: Parameters<typeof actual.solveAffineAlignment>
  ) => actual.solveAffineAlignment(...args));
});

const createSourceImage = (kind: 'eosin' | 'he'): PreprocessSourceImage => ({
  id: `${kind}-source`,
  kind,
  fileName: `${kind}.png`,
  mimeType: 'image/png',
  sizeBytes: 1024,
  width: 1000,
  height: 1000,
  lastModified: 1,
  dataUrl: 'data:image/png;base64,AA==',
});

const createClusteredControlPoints = (): AlignmentControlPoint[] => [
  { id: 'pair-1', source: { x: 0.5, y: 0.5 }, target: { x: 0.51, y: 0.51 } },
  { id: 'pair-2', source: { x: 0.505, y: 0.5 }, target: { x: 0.515, y: 0.51 } },
  { id: 'pair-3', source: { x: 0.5, y: 0.505 }, target: { x: 0.51, y: 0.515 } },
  { id: 'pair-4', source: { x: 0.507, y: 0.503 }, target: { x: 0.517, y: 0.513 } },
  { id: 'pair-5', source: { x: 0.503, y: 0.507 }, target: { x: 0.513, y: 0.517 } },
  { id: 'pair-6', source: { x: 0.509, y: 0.506 }, target: { x: 0.519, y: 0.516 } },
  { id: 'pair-7', source: { x: 0.506, y: 0.509 }, target: { x: 0.516, y: 0.519 } },
];

const createAlignmentSlice = (): AlignmentSlice => ({
  status: 'ready',
  isStale: false,
  updatedAt: null,
  error: null,
  referenceImage: 'eosin',
  movingImage: 'he',
  movingImageTransform: {
    rotationDegrees: 0,
    flipHorizontal: false,
    flipVertical: false,
    scale: 1,
  },
  overlayOpacity: 0.5,
  controlPoints: createClusteredControlPoints(),
  inlierMask: null,
  affineMatrix: null,
  reprojectionRmse: null,
  inlierRatio: null,
  ransacReprojThreshold: null,
  qualityFlags: {
    minPairs: true,
    inlierRatio: false,
    rmse: false,
    finiteMatrix: false,
    scaleRange: false,
    accepted: false,
  },
  solveAccepted: false,
  failureReason: null,
  transform: null,
  previewDataUrl: null,
});

describe('AlignmentPanel', () => {
  it('does not auto-advance when all-points solve is rejected by strict acceptance', async () => {
    const onSolveAccepted = vi.fn();

    render(
      <ChakraProvider theme={theme}>
        <AlignmentPanel
          alignment={createAlignmentSlice()}
          chipBounds={{ x: 0, y: 0, width: 1, height: 1 }}
          movingImage={createSourceImage('he')}
          onSolveAccepted={onSolveAccepted}
          referenceImage={createSourceImage('eosin')}
          onAlignmentChange={vi.fn()}
        />
      </ChakraProvider>,
    );

    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByTestId('alignment-run-solve')).toBeEnabled();
    });

    await user.click(screen.getByTestId('alignment-run-solve'));

    await waitFor(() => {
      expect(solveAffineAlignmentMock).toHaveBeenCalledTimes(1);
    });

    const solveResult = solveAffineAlignmentMock.mock.results[0]?.value;
    expect(solveResult?.qualityFlags.accepted).toBe(false);

    await waitFor(() => {
      expect(onSolveAccepted).not.toHaveBeenCalled();
    });
  });
});
