import { ChakraProvider } from '@chakra-ui/react';
import { useCallback, useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { theme } from '../../../theme';
import type {
  AlignmentControlPoint,
  AlignmentSlice,
  LocalizationImageTransform,
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

  // jsdom does not implement pointer capture; the panel uses it for pan
  // sessions on the landmark canvases.
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
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

const createReferenceImageTransform = (): LocalizationImageTransform => ({
  rotationDegrees: 0,
  flipHorizontal: false,
  flipVertical: false,
  scale: 1,
});

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
  source: null,
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
  forceAccepted: false,
  failureReason: null,
  transform: null,
  previewDataUrl: null,
});

const createRejectedAlignmentSlice = (): AlignmentSlice => ({
  ...createAlignmentSlice(),
  status: 'error',
  affineMatrix: [1, 0, 5, 0, 1, 5],
  reprojectionRmse: 42.5,
  ransacReprojThreshold: 8,
  solveAccepted: false,
  forceAccepted: false,
  failureReason: 'rmse-too-high',
  qualityFlags: {
    minPairs: true,
    inlierRatio: true,
    rmse: false,
    finiteMatrix: true,
    scaleRange: true,
    accepted: false,
  },
});

describe('AlignmentPanel', () => {
  it('preserves dynamic values in the revised workflow labels', async () => {
    render(
      <ChakraProvider theme={theme}>
        <AlignmentPanel
          alignment={createAlignmentSlice()}
          chipBounds={{ x: 0, y: 0, width: 1, height: 1 }}
          movingImage={createSourceImage('he')}
          onSolveAccepted={vi.fn()}
          referenceImage={createSourceImage('eosin')}
          referenceImageTransform={createReferenceImageTransform()}
          showMovingImagePaddingBoundary={false}
          onAlignmentChange={vi.fn()}
        />
      </ChakraProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('alignment-run-solve')).toBeEnabled();
    });

    expect(screen.getByText('Image Registration')).toBeInTheDocument();
    expect(screen.getByTestId('alignment-pair-count-badge')).toHaveTextContent('Landmark Pairs: 7 / 15');
    // The pair-editing toolbar is contextual: reserved but hidden until a landmark is selected.
    expect(screen.getByTestId('alignment-pair-actions')).toHaveStyle({ visibility: 'hidden' });
    const firstLandmark = screen
      .getByTestId('alignment-add-point-eosin')
      .querySelector('circle');
    expect(firstLandmark).not.toBeNull();
    fireEvent.pointerDown(firstLandmark as Element, { buttons: 1, pointerId: 1 });
    expect(screen.getByRole('button', { name: 'Move NATA Align Image Point' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move HE point' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registration Preview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear All Pairs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review Registration' })).toBeInTheDocument();
    expect(screen.getByTestId('alignment-distribution-warning')).toHaveTextContent(
      'Landmark spread is narrow. Coverage ratios are 0.9% width and 0.9% height, below the 20% minimum.',
    );
    expect(screen.getByText(/For genuinely small tissue/)).toHaveTextContent(
      'If the overlay is correct, choose Force continue to proceed.',
    );
    expect(screen.queryByTestId('alignment-moving-view-controls')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Zoom out HE image')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Zoom in HE image')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Rotate HE left 90 degrees')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Rotate HE right 90 degrees')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Rotate HE left 1 degree')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Rotate HE right 1 degree')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Flip HE horizontally')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Flip HE vertically')).not.toBeInTheDocument();

    const targetLayer = await screen.findByTestId('alignment-target-image-transform-layer');
    const targetViewport = targetLayer.parentElement;
    expect(targetViewport).not.toBeNull();
    const widthBeforeWheel = targetViewport ? getComputedStyle(targetViewport).width : null;

    fireEvent.wheel(screen.getByTestId('alignment-add-point-he'), {
      clientX: 320,
      clientY: 240,
      deltaY: -100,
    });

    await waitFor(() => {
      expect(targetViewport ? getComputedStyle(targetViewport).width : null).not.toBe(widthBeforeWheel);
    });
    expect(screen.getByAltText('HE landmarks (moving)')).toBeInTheDocument();
  });

  it('lays out registration controls in normal flow with stable action groups', () => {
    render(
      <ChakraProvider theme={theme}>
        <AlignmentPanel
          alignment={createAlignmentSlice()}
          chipBounds={{ x: 0, y: 0, width: 1, height: 1 }}
          movingImage={createSourceImage('he')}
          onSolveAccepted={vi.fn()}
          referenceImage={createSourceImage('eosin')}
          referenceImageTransform={createReferenceImageTransform()}
          showMovingImagePaddingBoundary={false}
          onAlignmentChange={vi.fn()}
        />
      </ChakraProvider>,
    );

    const layout = screen.getByTestId('alignment-layout');
    const workflowCard = screen.getByTestId('alignment-workflow-overlay');
    const messages = screen.getByTestId('alignment-messages');
    const canvasGrid = screen.getByTestId('alignment-canvas-grid');

    expect(Array.from(layout.children).slice(0, 3)).toEqual([
      workflowCard,
      canvasGrid,
      messages,
    ]);
    expect(getComputedStyle(workflowCard).position).not.toBe('absolute');
    // The contextual pair-editing toolbar stays mounted but hidden until a pair is selected.
    expect(screen.getByTestId('alignment-pair-actions')).toHaveStyle({ visibility: 'hidden' });
    expect(
      within(screen.getByTestId('alignment-workspace-actions'))
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual(['Registration Preview', 'Undo last point', 'Clear All Pairs']);
    expect(
      within(screen.getByTestId('alignment-decision-actions'))
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual(['Review Registration']);

    const firstLandmark = screen
      .getByTestId('alignment-add-point-eosin')
      .querySelector('circle');
    expect(firstLandmark).not.toBeNull();
    fireEvent.pointerDown(firstLandmark as Element, { buttons: 1, pointerId: 1 });

    expect(
      within(screen.getByTestId('alignment-pair-actions'))
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual([
      'Move NATA Align Image Point',
      'Move HE point',
      'Delete pair',
      'Cancel',
    ]);
  });

  it('removes only the retired workflow hints', () => {
    render(
      <ChakraProvider theme={theme}>
        <AlignmentPanel
          alignment={createAlignmentSlice()}
          chipBounds={{ x: 0, y: 0, width: 1, height: 1 }}
          movingImage={createSourceImage('he')}
          onSolveAccepted={vi.fn()}
          referenceImage={createSourceImage('eosin')}
          referenceImageTransform={createReferenceImageTransform()}
          showMovingImagePaddingBoundary={false}
          onAlignmentChange={vi.fn()}
        />
      </ChakraProvider>,
    );

    expect(screen.queryByText('Drag to pan. Wheel to zoom. Add or adjust landmark pairs in order.')).not.toBeInTheDocument();
    expect(screen.queryByText('Pan, zoom, and place landmarks.')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Show canvas help')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Minimize canvas help')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Dismiss canvas help')).not.toBeInTheDocument();
    expect(screen.getByAltText('Eosin landmarks (reference)')).toBeInTheDocument();
    expect(screen.getByAltText('HE landmarks (moving)')).toBeInTheDocument();
  });

  it('uses HE terminology in missing-image guidance', () => {
    render(
      <ChakraProvider theme={theme}>
        <AlignmentPanel
          alignment={createAlignmentSlice()}
          chipBounds={{ x: 0, y: 0, width: 1, height: 1 }}
          movingImage={null}
          onSolveAccepted={vi.fn()}
          referenceImage={createSourceImage('eosin')}
          referenceImageTransform={createReferenceImageTransform()}
          showMovingImagePaddingBoundary={false}
          onAlignmentChange={vi.fn()}
        />
      </ChakraProvider>,
    );

    expect(screen.getByText('Registration needs both source images')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Eosin and HE images must be present before landmark pairing and registration solving can run.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/H&E/)).not.toBeInTheDocument();
  });

  it('renders working preview URLs in alignment image panes while canonical data URLs remain available', async () => {
    const referenceImage = {
      ...createSourceImage('eosin'),
      dataUrl: 'blob:eosin-canonical',
      workingDataUrl: 'blob:eosin-working',
    };
    const movingImage = {
      ...createSourceImage('he'),
      dataUrl: 'blob:he-canonical',
      workingDataUrl: 'blob:he-working',
    };

    render(
      <ChakraProvider theme={theme}>
        <AlignmentPanel
          alignment={createAlignmentSlice()}
          chipBounds={{ x: 0, y: 0, width: 1, height: 1 }}
          movingImage={movingImage}
          onSolveAccepted={vi.fn()}
          referenceImage={referenceImage}
          referenceImageTransform={createReferenceImageTransform()}
          showMovingImagePaddingBoundary={false}
          onAlignmentChange={vi.fn()}
        />
      </ChakraProvider>,
    );

    const sourceLayer = await screen.findByTestId('alignment-source-image-transform-layer');
    const targetLayer = await screen.findByTestId('alignment-target-image-transform-layer');

    expect(within(sourceLayer).getByRole('img')).toHaveAttribute('src', 'blob:eosin-working');
    expect(within(targetLayer).getByRole('img')).toHaveAttribute('src', 'blob:he-working');
    expect(referenceImage.dataUrl).toBe('blob:eosin-canonical');
    expect(movingImage.dataUrl).toBe('blob:he-canonical');
  });

  it('renders the moving-image padding boundary only for the target pane and keeps it coupled to the shared transform layer', async () => {
    const alignment = createAlignmentSlice();
    alignment.movingImageTransform = {
      rotationDegrees: 90,
      flipHorizontal: true,
      flipVertical: false,
      scale: 1,
    };

    const { rerender } = render(
      <ChakraProvider theme={theme}>
        <AlignmentPanel
          alignment={alignment}
          chipBounds={{ x: 0, y: 0, width: 1, height: 1 }}
          movingImage={createSourceImage('he')}
          onSolveAccepted={vi.fn()}
          referenceImage={createSourceImage('eosin')}
          referenceImageTransform={createReferenceImageTransform()}
          showMovingImagePaddingBoundary={true}
          onAlignmentChange={vi.fn()}
        />
      </ChakraProvider>,
    );

    expect(await screen.findByTestId('alignment-target-image-boundary')).toBeInTheDocument();
    expect(screen.queryByTestId('alignment-source-image-boundary')).not.toBeInTheDocument();

    const transformLayer = screen.getByTestId('alignment-target-image-transform-layer');
    expect(transformLayer).toHaveStyle({
      transform: 'scale(-1, 1) rotate(90deg)',
      transformOrigin: 'center center',
    });
    expect(within(transformLayer).getByTestId('alignment-target-image-boundary')).toBeInTheDocument();

    rerender(
      <ChakraProvider theme={theme}>
        <AlignmentPanel
          alignment={alignment}
          chipBounds={{ x: 0, y: 0, width: 1, height: 1 }}
          movingImage={createSourceImage('he')}
          onSolveAccepted={vi.fn()}
          referenceImage={createSourceImage('eosin')}
          referenceImageTransform={createReferenceImageTransform()}
          showMovingImagePaddingBoundary={false}
          onAlignmentChange={vi.fn()}
        />
      </ChakraProvider>,
    );

    expect(screen.queryByTestId('alignment-target-image-boundary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('alignment-source-image-boundary')).not.toBeInTheDocument();
  });

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
          referenceImageTransform={createReferenceImageTransform()}
          showMovingImagePaddingBoundary={false}
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

	it('keeps manual alignment controls available', async () => {
		render(
			<ChakraProvider theme={theme}>
				<AlignmentPanel
					alignment={createAlignmentSlice()}
					chipBounds={{ x: 0, y: 0, width: 1, height: 1 }}
					movingImage={createSourceImage('he')}
					onSolveAccepted={vi.fn()}
					referenceImage={createSourceImage('eosin')}
					referenceImageTransform={createReferenceImageTransform()}
					showMovingImagePaddingBoundary={false}
					onAlignmentChange={vi.fn()}
				/>
			</ChakraProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId('alignment-run-solve')).toBeEnabled();
		});
	});

	it('hides Force accept when no finite matrix is available', () => {
		render(
			<ChakraProvider theme={theme}>
				<AlignmentPanel
					alignment={createAlignmentSlice()}
					chipBounds={{ x: 0, y: 0, width: 1, height: 1 }}
					movingImage={createSourceImage('he')}
					onSolveAccepted={vi.fn()}
					referenceImage={createSourceImage('eosin')}
					referenceImageTransform={createReferenceImageTransform()}
					showMovingImagePaddingBoundary={false}
					onAlignmentChange={vi.fn()}
				/>
			</ChakraProvider>,
		);

		expect(screen.queryByTestId('alignment-force-accept')).not.toBeInTheDocument();
	});

	it('force-accepts a rejected solve with a finite matrix and advances', async () => {
		const onSolveAccepted = vi.fn();
		const onAlignmentChange = vi.fn();

		render(
			<ChakraProvider theme={theme}>
				<AlignmentPanel
					alignment={createRejectedAlignmentSlice()}
					chipBounds={{ x: 0, y: 0, width: 1, height: 1 }}
					movingImage={createSourceImage('he')}
					onSolveAccepted={onSolveAccepted}
					referenceImage={createSourceImage('eosin')}
					referenceImageTransform={createReferenceImageTransform()}
					showMovingImagePaddingBoundary={false}
					onAlignmentChange={onAlignmentChange}
				/>
			</ChakraProvider>,
		);

		const forceButton = await screen.findByTestId('alignment-force-accept');
		expect(forceButton).toBeEnabled();
		expect(
			within(screen.getByTestId('alignment-decision-actions'))
				.getAllByRole('button')
				.map((button) => button.textContent?.trim()),
		).toEqual(['Review Registration', 'Force continue']);

		const user = userEvent.setup();
		await user.click(forceButton);

		expect(onSolveAccepted).toHaveBeenCalledTimes(1);
		expect(onAlignmentChange).toHaveBeenCalledTimes(1);

		const updater = onAlignmentChange.mock.calls[0][0] as (
			current: AlignmentSlice,
		) => AlignmentSlice;
		const next = updater(createRejectedAlignmentSlice());

		expect(next.forceAccepted).toBe(true);
		expect(next.solveAccepted).toBe(true);
		expect(next.status).toBe('complete');
		expect(next.failureReason).toBeNull();
		expect(next.affineMatrix).toEqual([1, 0, 5, 0, 1, 5]);
	});

	it('lets the user retry OpenCV initialization after a transient failure', async () => {
		loadOpenCvMock
			.mockRejectedValueOnce(new Error('OpenCV runtime initialization timed out'))
			.mockResolvedValueOnce({ cv: createOpenCvRuntimeStub() });

		render(
			<ChakraProvider theme={theme}>
				<AlignmentPanel
					alignment={createAlignmentSlice()}
					chipBounds={{ x: 0, y: 0, width: 1, height: 1 }}
					movingImage={createSourceImage('he')}
					onSolveAccepted={vi.fn()}
					referenceImage={createSourceImage('eosin')}
					referenceImageTransform={createReferenceImageTransform()}
					showMovingImagePaddingBoundary={false}
					onAlignmentChange={vi.fn()}
				/>
			</ChakraProvider>,
		);

		const retryButton = await screen.findByTestId('alignment-retry-opencv');
		expect(retryButton).toHaveTextContent('Retry OpenCV');

		const user = userEvent.setup();
		await user.click(retryButton);

		await waitFor(() => {
			expect(screen.getByTestId('alignment-runtime-status-badge')).toHaveAttribute(
				'data-runtime-status',
				'ready',
			);
		});
		expect(loadOpenCvMock).toHaveBeenCalledTimes(2);
	});

	it('exposes per-canvas zoom controls that update the visible zoom value', async () => {
		render(
			<ChakraProvider theme={theme}>
				<AlignmentPanel
					alignment={createAlignmentSlice()}
					chipBounds={{ x: 0, y: 0, width: 1, height: 1 }}
					movingImage={createSourceImage('he')}
					onSolveAccepted={vi.fn()}
					referenceImage={createSourceImage('eosin')}
					referenceImageTransform={createReferenceImageTransform()}
					showMovingImagePaddingBoundary={false}
					onAlignmentChange={vi.fn()}
				/>
			</ChakraProvider>,
		);

		const zoomValue = screen.getByTestId('alignment-source-zoom-value');
		expect(zoomValue).toHaveTextContent('100%');
		expect(screen.getByTestId('alignment-target-zoom-controls')).toBeInTheDocument();

		const user = userEvent.setup();
		await user.click(screen.getByTestId('alignment-source-zoom-in'));
		expect(zoomValue).toHaveTextContent('120%');

		await user.click(screen.getByTestId('alignment-source-zoom-reset'));
		expect(zoomValue).toHaveTextContent('100%');
	});

	it('highlights the active canvas and lets undo cancel a pending point before removing pairs', async () => {
		const onAlignmentChange = vi.fn(
			(
				updater: (
					current: AlignmentSlice,
				) => AlignmentSlice,
			) => updater,
		);

		function StatefulHarness() {
			const [slice, setSlice] = useState<AlignmentSlice>(() => ({
				...createAlignmentSlice(),
				controlPoints: [],
			}));
		const handleChange = useCallback(
			(next: (current: AlignmentSlice) => AlignmentSlice) => {
				onAlignmentChange(next);
				setSlice((current) => next(current));
			},
			// onAlignmentChange comes from the enclosing test scope and never
			// changes identity between renders.
			[],
		);

			return (
				<ChakraProvider theme={theme}>
					<AlignmentPanel
						alignment={slice}
						chipBounds={{ x: 0, y: 0, width: 1, height: 1 }}
						movingImage={createSourceImage('he')}
						onSolveAccepted={vi.fn()}
						referenceImage={createSourceImage('eosin')}
						referenceImageTransform={createReferenceImageTransform()}
						showMovingImagePaddingBoundary={false}
						onAlignmentChange={handleChange}
					/>
				</ChakraProvider>
			);
		}

		render(<StatefulHarness />);

		expect(screen.getByTestId('alignment-workflow-instruction')).toHaveTextContent(
			'Use wheel zoom and drag pan on the eosin reference, then click to place the next reference landmark.',
		);
		expect(screen.getByTestId('alignment-source-active-badge')).toBeInTheDocument();
		expect(screen.getByTestId('alignment-target-active-badge')).toHaveStyle({
			visibility: 'hidden',
		});

		const eosinHost = screen.getByTestId('alignment-add-point-eosin');
		// jsdom's PointerEvent drops clientX/clientY init, so dispatch events with
		// assigned coordinates (same pattern as the CanvasStage tests).
		const firePointer = (el: Element, type: string, x: number, y: number) => {
			const event = new Event(type, { bubbles: true, cancelable: true });
			Object.assign(event, { buttons: 1, clientX: x, clientY: y, pointerId: 1 });
			el.dispatchEvent(event);
		};
		firePointer(eosinHost, 'pointerdown', 320, 240);
		firePointer(eosinHost, 'pointerup', 320, 240);

		await waitFor(() => {
			expect(screen.getByTestId('alignment-target-active-badge')).toBeVisible();
		});
		expect(screen.getByTestId('alignment-source-active-badge')).toHaveStyle({
			visibility: 'hidden',
		});

		const undoButton = screen.getByTestId('alignment-undo-last-point');
		expect(undoButton).toBeEnabled();
		const user = userEvent.setup();
		await user.click(undoButton);

		expect(onAlignmentChange).not.toHaveBeenCalled();
		expect(screen.getByTestId('alignment-pair-count-badge')).toHaveTextContent(
			'Landmark Pairs: 0 / 15',
		);
	});
});
