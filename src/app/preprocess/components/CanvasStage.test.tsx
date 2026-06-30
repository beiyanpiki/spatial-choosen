import { ChakraProvider } from '@chakra-ui/react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { clampNormalizedSquareRect, resizeChipBounds, translateChipBounds } from '../../../lib/preprocess/localization';
import { theme } from '../../../theme';
import type {
	LocalizationImageTransform,
	PreprocessRect,
	PreprocessSourceImage,
} from '../../../types/preprocess';
import { CanvasStage } from './CanvasStage';

const HOST_WIDTH = 800;
const HOST_HEIGHT = 600;
const IMAGE_ASPECT_RATIO = 4 / 3;

const drawImageMock = vi.fn();
const clearRectMock = vi.fn();
const setTransformMock = vi.fn();
const saveMock = vi.fn();
const translateMock = vi.fn();
const rotateMock = vi.fn();
const scaleMock = vi.fn();
const restoreMock = vi.fn();
const imageSrcAssignments: string[] = [];

const contextStub = {
	clearRect: clearRectMock,
	drawImage: drawImageMock,
	setTransform: setTransformMock,
	save: saveMock,
	translate: translateMock,
	rotate: rotateMock,
	scale: scaleMock,
	restore: restoreMock,
	fillStyle: '',
	strokeStyle: '',
	lineWidth: 1,
};

const createImage = (): PreprocessSourceImage => ({
	id: 'eosin-source',
	kind: 'eosin',
	fileName: 'eosin.png',
	mimeType: 'image/png',
	sizeBytes: 1024,
	width: 400,
	height: 300,
	lastModified: 1,
	dataUrl: 'data:image/png;base64,AA==',
});

const createTransform = (): LocalizationImageTransform => ({
	rotationDegrees: 0,
	flipHorizontal: false,
	flipVertical: false,
	scale: 1,
});

const createChipBounds = (): PreprocessRect => ({
	x: 0.2,
	y: 0.2,
	width: 0.2,
	height: 0.2,
});

beforeAll(() => {
	class ResizeObserverMock {
		observe() {}
		disconnect() {}
		unobserve() {}
	}

	vi.stubGlobal('ResizeObserver', ResizeObserverMock);
	Object.defineProperty(window, 'devicePixelRatio', {
		configurable: true,
		value: 1,
	});
	Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', {
		configurable: true,
		get() {
			return HOST_WIDTH;
		},
	});
	Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {
		configurable: true,
		get() {
			return HOST_HEIGHT;
		},
	});
	Object.defineProperty(HTMLDivElement.prototype, 'getBoundingClientRect', {
		configurable: true,
		value: () => ({
			width: HOST_WIDTH,
			height: HOST_HEIGHT,
			left: 0,
			top: 0,
			right: HOST_WIDTH,
			bottom: HOST_HEIGHT,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		}),
	});

	class MockImage {
		onload: (() => void) | null = null;
		onerror: (() => void) | null = null;
		private value = '';
		width = 400;
		height = 300;
		naturalWidth = 400;
		naturalHeight = 300;

		get src() {
			return this.value;
		}

		set src(value: string) {
			this.value = value;
			imageSrcAssignments.push(value);
			queueMicrotask(() => {
				this.onload?.();
			});
		}
	}

	vi.stubGlobal('Image', MockImage);
	HTMLCanvasElement.prototype.getContext = vi.fn(() => contextStub) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
	vi.clearAllMocks();
	imageSrcAssignments.length = 0;
	contextStub.fillStyle = '';
	contextStub.strokeStyle = '';
	contextStub.lineWidth = 1;
});

const parsePoints = (value: string | null) => {
	if (!value) return [];

	return value
		.trim()
		.split(/\s+/)
		.map((pair) => pair.split(',').map(Number) as [number, number]);
};

const readOutlinePoints = () => parsePoints(screen.getByTestId('localize-box-outline').getAttribute('points'));

const readLowerLeftMarkerPoints = () => parsePoints(screen.getByTestId('localize-box-lower-left-marker').getAttribute('points'));

const readChipBounds = () => JSON.parse(screen.getByTestId('stage-chip-bounds').textContent ?? 'null') as PreprocessRect;

const readTransform = () => JSON.parse(screen.getByTestId('stage-transform').textContent ?? 'null') as LocalizationImageTransform;

const getRectSourceCorners = (rect: PreprocessRect) => [
	{ x: rect.x, y: rect.y },
	{ x: rect.x + rect.width, y: rect.y },
	{ x: rect.x + rect.width, y: rect.y + rect.height },
	{ x: rect.x, y: rect.y + rect.height },
] as const;

const sourcePointToScreen = (
	point: { x: number; y: number },
) => [point.x * HOST_WIDTH, point.y * HOST_HEIGHT] as [number, number];

const expectPointPairsCloseTo = (
	actual: [number, number][],
	expected: [number, number][],
) => {
	expect(actual).toHaveLength(expected.length);
	for (const [index, expectedPoint] of expected.entries()) {
		expect(actual[index][0]).toBeCloseTo(expectedPoint[0], 6);
		expect(actual[index][1]).toBeCloseTo(expectedPoint[1], 6);
	}
};

const expectPointCloseTo = (actual: [number, number], expected: [number, number]) => {
	expect(actual[0]).toBeCloseTo(expected[0], 6);
	expect(actual[1]).toBeCloseTo(expected[1], 6);
};

const expectMarkerAnchorCloseToVisualLowerLeft = (
	markerPoints: [number, number][],
	polygonPoints: [number, number][],
) => {
	const lowerLeft = polygonPoints.reduce((selected, point) => (
		point[1] > selected[1] || (point[1] === selected[1] && point[0] < selected[0]) ? point : selected
	));
	expectPointCloseTo(markerPoints[1], lowerLeft);
};

const expectRectCloseTo = (actual: PreprocessRect, expected: PreprocessRect) => {
	expect(actual.x).toBeCloseTo(expected.x, 12);
	expect(actual.y).toBeCloseTo(expected.y, 12);
	expect(actual.width).toBeCloseTo(expected.width, 12);
	expect(actual.height).toBeCloseTo(expected.height, 12);
};

const expectRectCallCloseTo = (
	calls: readonly (readonly [PreprocessRect])[],
	index: number,
	expected: PreprocessRect,
) => {
	const actual = calls[index]?.[0];
	expect(actual).toBeDefined();
	if (!actual) throw new Error(`Missing rect call at index ${index}`);
	expectRectCloseTo(actual, expected);
};

const readRotationHandlePoint = () => {
	const handle = screen.getByTestId('localize-rotation-handle-visible');

	return {
		x: Number(handle.getAttribute('cx')),
		y: Number(handle.getAttribute('cy')),
	};
};

const dispatchPointerEvent = (
	target: EventTarget,
	type: string,
	init: { buttons?: number; clientX: number; clientY: number; pointerId?: number },
) => {
	const event = new Event(type, { bubbles: true, cancelable: true }) as Event & typeof init;
	Object.assign(event, init);
	const dispatchTarget = target === window ? document : target;
	dispatchTarget.dispatchEvent(event);
};

function StageHarness() {
	const [chipBounds, setChipBounds] = useState<PreprocessRect>(createChipBounds());
	const [transform, setTransform] = useState<LocalizationImageTransform>(createTransform());

	return (
		<ChakraProvider theme={theme}>
			<div data-testid="stage-chip-bounds">{JSON.stringify(chipBounds)}</div>
			<div data-testid="stage-transform">{JSON.stringify(transform)}</div>
			<CanvasStage
				boxColor="green"
				chipBounds={chipBounds}
				controlTestIdPrefix="localize"
				image={createImage()}
				imageTransform={transform}
				onChipBoundsChange={(nextBounds) => setChipBounds(nextBounds)}
				onFlipHorizontal={() => setTransform((current) => ({ ...current, flipHorizontal: !current.flipHorizontal }))}
				onFlipVertical={() => setTransform((current) => ({ ...current, flipVertical: !current.flipVertical }))}
				onResetTransform={() => setTransform(createTransform())}
				onRotationChange={(rotationDegrees) => setTransform((current) => ({ ...current, rotationDegrees }))}
				onRotationDelta={(delta) => setTransform((current) => ({ ...current, rotationDegrees: current.rotationDegrees + delta }))}
				onScaleChange={(scale) => setTransform((current) => ({ ...current, scale }))}
				onScaleDelta={(delta) => setTransform((current) => ({ ...current, scale: current.scale + delta }))}
			/>
		</ChakraProvider>
	);
}

function StageCommitHarness({
	allowOutOfBoundsChipBounds = false,
	imageTransform = createTransform(),
	onChipBoundsChangeSpy,
	onChipBoundsCancelSpy,
	onChipBoundsCommitSpy,
}: {
	allowOutOfBoundsChipBounds?: boolean;
	imageTransform?: LocalizationImageTransform;
	onChipBoundsChangeSpy: (bounds: PreprocessRect) => void;
	onChipBoundsCancelSpy?: () => void;
	onChipBoundsCommitSpy: (bounds: PreprocessRect) => void;
}) {
	const [chipBounds, setChipBounds] = useState<PreprocessRect>(createChipBounds());

	return (
		<ChakraProvider theme={theme}>
			<div data-testid="stage-chip-bounds">{JSON.stringify(chipBounds)}</div>
			<CanvasStage
				allowOutOfBoundsChipBounds={allowOutOfBoundsChipBounds}
				boxColor="green"
				chipBounds={chipBounds}
				controlTestIdPrefix="localize"
				image={createImage()}
				imageTransform={imageTransform}
				onChipBoundsCancel={onChipBoundsCancelSpy}
				onChipBoundsChange={(nextBounds) => {
					onChipBoundsChangeSpy(nextBounds);
					setChipBounds(nextBounds);
				}}
				onChipBoundsCommit={(nextBounds) => {
					onChipBoundsCommitSpy(nextBounds);
				}}
				onFlipHorizontal={vi.fn()}
				onFlipVertical={vi.fn()}
				onResetTransform={vi.fn()}
				onRotationChange={vi.fn()}
				onRotationDelta={vi.fn()}
				onScaleChange={vi.fn()}
				onScaleDelta={vi.fn()}
			/>
		</ChakraProvider>
	);
}

describe('CanvasStage', () => {
	it('loads the working image URL for interactive previews before falling back to canonical source data', async () => {
		render(
			<ChakraProvider theme={theme}>
				<CanvasStage
					boxColor="green"
					chipBounds={createChipBounds()}
					image={{
						...createImage(),
						thumbnailDataUrl: 'blob:thumbnail-preview',
						workingDataUrl: 'blob:working-preview',
					}}
					imageTransform={createTransform()}
					onChipBoundsChange={vi.fn()}
					onFlipHorizontal={vi.fn()}
					onFlipVertical={vi.fn()}
					onResetTransform={vi.fn()}
					onRotationChange={vi.fn()}
					onRotationDelta={vi.fn()}
					onScaleChange={vi.fn()}
					onScaleDelta={vi.fn()}
				/>
			</ChakraProvider>,
		);

		await waitFor(() => {
			expect(imageSrcAssignments).toContain('blob:working-preview');
		});
		expect(imageSrcAssignments).not.toContain('blob:thumbnail-preview');
		expect(imageSrcAssignments).not.toContain('data:image/png;base64,AA==');
	});

	it('keeps overlay points canvas-axis-aligned while image orientation changes', async () => {
		render(<StageHarness />);

		await waitFor(() => {
			expect(screen.getByTestId('localize-box-outline')).toBeInTheDocument();
		});

		const initialBounds = readChipBounds();
		const initialRect = clampNormalizedSquareRect(createChipBounds(), IMAGE_ASPECT_RATIO);
		const initialPoints = getRectSourceCorners(initialRect).map((point) => sourcePointToScreen(point));

		expectPointPairsCloseTo(readOutlinePoints(), initialPoints);

		fireEvent.click(screen.getByTestId('localize-stage-rotate-right-90'));

		await waitFor(() => {
			expect(readTransform()).toMatchObject({ rotationDegrees: 90 });
		});

		const rotatedOutlinePoints = readOutlinePoints();
		expectPointPairsCloseTo(rotatedOutlinePoints, initialPoints);
		expectMarkerAnchorCloseToVisualLowerLeft(readLowerLeftMarkerPoints(), initialPoints);
		expect(readChipBounds()).toEqual(initialBounds);

		fireEvent.click(screen.getByTestId('localize-stage-flip-horizontal'));

		await waitFor(() => {
			expect(readTransform()).toMatchObject({ flipHorizontal: true });
		});

		expectPointPairsCloseTo(readOutlinePoints(), initialPoints);
		expectMarkerAnchorCloseToVisualLowerLeft(readLowerLeftMarkerPoints(), initialPoints);
		expect(readChipBounds()).toEqual(initialBounds);
	});

	it('uses canvas-axis pointer coordinates for body drag updates and commits', async () => {
		const onChipBoundsChangeSpy = vi.fn<(bounds: PreprocessRect) => void>();
		const onChipBoundsCommitSpy = vi.fn<(bounds: PreprocessRect) => void>();
		const rotatedTransform = { ...createTransform(), rotationDegrees: 90 };

		render(
			<StageCommitHarness
				imageTransform={rotatedTransform}
				onChipBoundsChangeSpy={onChipBoundsChangeSpy}
				onChipBoundsCommitSpy={onChipBoundsCommitSpy}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByTestId('localize-box-outline')).toBeInTheDocument();
		});

		const initialRect = clampNormalizedSquareRect(createChipBounds(), IMAGE_ASPECT_RATIO);
		const startSourcePoint = {
			x: initialRect.x + initialRect.width / 2,
			y: initialRect.y + initialRect.height / 2,
		};
		const [startScreenX, startScreenY] = sourcePointToScreen(startSourcePoint);
		const firstSourcePoint = {
			x: startSourcePoint.x + 0.1,
			y: startSourcePoint.y,
		};
		const finalSourcePoint = {
			x: startSourcePoint.x + 0.2,
			y: startSourcePoint.y + 0.1,
		};
		const [firstScreenX, firstScreenY] = sourcePointToScreen(firstSourcePoint);
		const [finalScreenX, finalScreenY] = sourcePointToScreen(finalSourcePoint);
		const firstScreenPoint = { x: firstScreenX, y: firstScreenY };
		const finalScreenPoint = { x: finalScreenX, y: finalScreenY };
		const expectedFirstMove = translateChipBounds(
			initialRect,
			{
				x: firstSourcePoint.x - startSourcePoint.x,
				y: firstSourcePoint.y - startSourcePoint.y,
			},
			IMAGE_ASPECT_RATIO,
		);
		const expectedFinalMove = translateChipBounds(
			initialRect,
			{
				x: finalSourcePoint.x - startSourcePoint.x,
				y: finalSourcePoint.y - startSourcePoint.y,
			},
			IMAGE_ASPECT_RATIO,
		);

		const body = screen.getByTestId('localize-box-body');
		await act(async () => {
			dispatchPointerEvent(body, 'pointerdown', {
				buttons: 1,
				clientX: startScreenX,
				clientY: startScreenY,
				pointerId: 1,
			});
		});
		await act(async () => {
			dispatchPointerEvent(window, 'pointermove', {
				buttons: 1,
				clientX: firstScreenPoint.x,
				clientY: firstScreenPoint.y,
				pointerId: 1,
			});
			dispatchPointerEvent(window, 'pointermove', {
				buttons: 1,
				clientX: finalScreenPoint.x,
				clientY: finalScreenPoint.y,
				pointerId: 1,
			});
			dispatchPointerEvent(window, 'pointerup', {
				clientX: finalScreenPoint.x,
				clientY: finalScreenPoint.y,
				pointerId: 1,
			});
		});

		expect(onChipBoundsChangeSpy).toHaveBeenCalledTimes(2);
		expectRectCallCloseTo(onChipBoundsChangeSpy.mock.calls, 0, expectedFirstMove);
		expectRectCallCloseTo(onChipBoundsChangeSpy.mock.calls, 1, expectedFinalMove);
		expect(onChipBoundsCommitSpy).toHaveBeenCalledTimes(1);
		expectRectCallCloseTo(onChipBoundsCommitSpy.mock.calls, 0, expectedFinalMove);
		await waitFor(() => {
			expectRectCloseTo(readChipBounds(), expectedFinalMove);
		});
	});

	it('maps literal 800x600 canvas points directly for drag updates while the image is rotated', async () => {
		const onChipBoundsChangeSpy = vi.fn<(bounds: PreprocessRect) => void>();
		const onChipBoundsCommitSpy = vi.fn<(bounds: PreprocessRect) => void>();
		const rotatedTransform = { ...createTransform(), rotationDegrees: 90 };

		render(
			<StageCommitHarness
				imageTransform={rotatedTransform}
				onChipBoundsChangeSpy={onChipBoundsChangeSpy}
				onChipBoundsCommitSpy={onChipBoundsCommitSpy}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByTestId('localize-box-outline')).toBeInTheDocument();
		});

		const initialRect = clampNormalizedSquareRect(createChipBounds(), IMAGE_ASPECT_RATIO);
		const [cornerScreenX, cornerScreenY] = sourcePointToScreen({ x: 0.2, y: 0.2 });
		const [targetScreenX, targetScreenY] = sourcePointToScreen({ x: 0.3, y: 0.3 });
		const literalProjectedCorner = { x: cornerScreenX, y: cornerScreenY };
		const literalProjectedSourcePoint = { x: targetScreenX, y: targetScreenY };
		const expectedMove = translateChipBounds(
			initialRect,
			{ x: 0.1, y: 0.1 },
			IMAGE_ASPECT_RATIO,
		);

		expectPointPairsCloseTo([readOutlinePoints()[0]], [[literalProjectedCorner.x, literalProjectedCorner.y]]);

		const body = screen.getByTestId('localize-box-body');
		await act(async () => {
			dispatchPointerEvent(body, 'pointerdown', {
				buttons: 1,
				clientX: literalProjectedCorner.x,
				clientY: literalProjectedCorner.y,
				pointerId: 1,
			});
		});
		await act(async () => {
			dispatchPointerEvent(window, 'pointermove', {
				buttons: 1,
				clientX: literalProjectedSourcePoint.x,
				clientY: literalProjectedSourcePoint.y,
				pointerId: 1,
			});
			dispatchPointerEvent(window, 'pointerup', {
				clientX: literalProjectedSourcePoint.x,
				clientY: literalProjectedSourcePoint.y,
				pointerId: 1,
			});
		});

		expect(onChipBoundsChangeSpy).toHaveBeenCalledTimes(1);
		expectRectCallCloseTo(onChipBoundsChangeSpy.mock.calls, 0, expectedMove);
		expect(onChipBoundsCommitSpy).toHaveBeenCalledTimes(1);
		expectRectCallCloseTo(onChipBoundsCommitSpy.mock.calls, 0, expectedMove);
	});

	it('uses canvas-axis pointer coordinates for resize handles while the image is rotated', async () => {
		const onChipBoundsChangeSpy = vi.fn<(bounds: PreprocessRect) => void>();
		const onChipBoundsCommitSpy = vi.fn<(bounds: PreprocessRect) => void>();
		const rotatedTransform = { ...createTransform(), rotationDegrees: 90 };

		render(
			<StageCommitHarness
				imageTransform={rotatedTransform}
				onChipBoundsChangeSpy={onChipBoundsChangeSpy}
				onChipBoundsCommitSpy={onChipBoundsCommitSpy}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByTestId('localize-box-outline')).toBeInTheDocument();
		});

		const initialRect = clampNormalizedSquareRect(createChipBounds(), IMAGE_ASPECT_RATIO);
		const eastSourcePoint = {
			x: initialRect.x + initialRect.width,
			y: initialRect.y + initialRect.height / 2,
		};
		const targetSourcePoint = {
			x: initialRect.x + initialRect.width + 0.15,
			y: initialRect.y + initialRect.height / 2,
		};
		const [handleScreenX, handleScreenY] = sourcePointToScreen(eastSourcePoint);
		const [targetScreenX, targetScreenY] = sourcePointToScreen(targetSourcePoint);
		const expectedResizedRect = resizeChipBounds(
			initialRect,
			'e',
			targetSourcePoint,
			IMAGE_ASPECT_RATIO,
		);

		const eastHandle = screen.getByTestId('localize-box-handle-e');
		await act(async () => {
			dispatchPointerEvent(eastHandle, 'pointerdown', {
				buttons: 1,
				clientX: handleScreenX,
				clientY: handleScreenY,
				pointerId: 1,
			});
		});
		await act(async () => {
			dispatchPointerEvent(window, 'pointermove', {
				buttons: 1,
				clientX: targetScreenX,
				clientY: targetScreenY,
				pointerId: 1,
			});
			dispatchPointerEvent(window, 'pointerup', {
				clientX: targetScreenX,
				clientY: targetScreenY,
				pointerId: 1,
			});
		});

		expect(onChipBoundsChangeSpy).toHaveBeenCalledTimes(1);
		expectRectCallCloseTo(onChipBoundsChangeSpy.mock.calls, 0, expectedResizedRect);
		expect(onChipBoundsCommitSpy).toHaveBeenCalledTimes(1);
		expectRectCallCloseTo(onChipBoundsCommitSpy.mock.calls, 0, expectedResizedRect);
		await waitFor(() => {
			expectRectCloseTo(readChipBounds(), expectedResizedRect);
		});
	});

	it('lets the real rotation handle change rotation without mutating saved bounds', async () => {
		render(<StageHarness />);

		await waitFor(() => {
			expect(screen.getByTestId('localize-box-outline')).toBeInTheDocument();
		});

		const initialBounds = readChipBounds();
		const { x: handleX, y: handleY } = readRotationHandlePoint();

		await act(async () => {
			dispatchPointerEvent(screen.getByTestId('localize-rotation-handle-visible'), 'pointerdown', {
				buttons: 1,
				clientX: handleX,
				clientY: handleY,
				pointerId: 1,
			});
		});

		await act(async () => {
			dispatchPointerEvent(window, 'pointermove', {
				buttons: 1,
				clientX: 320,
				clientY: 200,
				pointerId: 1,
			});
			dispatchPointerEvent(window, 'pointerup', {
				clientX: 320,
				clientY: 200,
				pointerId: 1,
			});
		});

		await waitFor(() => {
			expect(readTransform().rotationDegrees).not.toBe(0);
		});
		const expectedFinalOutline = getRectSourceCorners(clampNormalizedSquareRect(createChipBounds(), IMAGE_ASPECT_RATIO))
			.map((point) => sourcePointToScreen(point));
		expectPointPairsCloseTo(readOutlinePoints(), expectedFinalOutline);
		expect(readChipBounds()).toEqual(initialBounds);
	});

	it('emits live drag updates on pointermove and a single final bounds commit on pointerup', async () => {
		const onChipBoundsChangeSpy = vi.fn<(bounds: PreprocessRect) => void>();
		const onChipBoundsCommitSpy = vi.fn<(bounds: PreprocessRect) => void>();

		render(
			<StageCommitHarness
				onChipBoundsChangeSpy={onChipBoundsChangeSpy}
				onChipBoundsCommitSpy={onChipBoundsCommitSpy}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByTestId('localize-box-outline')).toBeInTheDocument();
		});

		const initialRect = clampNormalizedSquareRect(createChipBounds(), IMAGE_ASPECT_RATIO);
		const expectedFirstMove = translateChipBounds(initialRect, { x: 0.1, y: 0.1 }, IMAGE_ASPECT_RATIO);
		const expectedFinalMove = translateChipBounds(initialRect, { x: 0.35, y: 1 / 6 }, IMAGE_ASPECT_RATIO);
		const body = screen.getByTestId('localize-box-body');

		await act(async () => {
			dispatchPointerEvent(body, 'pointerdown', {
				buttons: 1,
				clientX: 240,
				clientY: 200,
				pointerId: 1,
			});
		});

		await act(async () => {
			dispatchPointerEvent(window, 'pointermove', {
				buttons: 1,
				clientX: 320,
				clientY: 260,
				pointerId: 1,
			});
			dispatchPointerEvent(window, 'pointermove', {
				buttons: 1,
				clientX: 520,
				clientY: 300,
				pointerId: 1,
			});
		});

		expect(onChipBoundsChangeSpy).toHaveBeenCalledTimes(2);
		expectRectCallCloseTo(onChipBoundsChangeSpy.mock.calls, 0, expectedFirstMove);
		expectRectCallCloseTo(onChipBoundsChangeSpy.mock.calls, 1, expectedFinalMove);
		expect(onChipBoundsCommitSpy).not.toHaveBeenCalled();

		await act(async () => {
			dispatchPointerEvent(window, 'pointerup', {
				clientX: 520,
				clientY: 300,
				pointerId: 1,
			});
		});

		expect(onChipBoundsCommitSpy).toHaveBeenCalledTimes(1);
		expectRectCallCloseTo(onChipBoundsCommitSpy.mock.calls, 0, expectedFinalMove);
	});

	it('supports outward resize past the image edge when the caller opts out of image clamping', () => {
		const initialRect = clampNormalizedSquareRect(createChipBounds(), IMAGE_ASPECT_RATIO);
		const resizedPastRightEdge = resizeChipBounds(
			initialRect,
			'e',
			{ x: 1.4, y: 1 / 3 },
			IMAGE_ASPECT_RATIO,
			undefined,
			{ clampToImage: false },
		);
		expect(resizedPastRightEdge).toEqual({
			x: 0.2,
			y: -0.46666666666666656,
			width: 1.2,
			height: 1.5999999999999999,
		});
		expect(resizedPastRightEdge.x + resizedPastRightEdge.width).toBeGreaterThan(1);
		expect(resizedPastRightEdge.y).toBeLessThan(0);
		expect(resizedPastRightEdge.y + resizedPastRightEdge.height).toBeGreaterThan(1);
	});

	it('clears drag state through the cancel callback without committing bounds', async () => {
		const onChipBoundsChangeSpy = vi.fn<(bounds: PreprocessRect) => void>();
		const onChipBoundsCancelSpy = vi.fn();
		const onChipBoundsCommitSpy = vi.fn<(bounds: PreprocessRect) => void>();

		render(
			<StageCommitHarness
				onChipBoundsChangeSpy={onChipBoundsChangeSpy}
				onChipBoundsCancelSpy={onChipBoundsCancelSpy}
				onChipBoundsCommitSpy={onChipBoundsCommitSpy}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByTestId('localize-box-outline')).toBeInTheDocument();
		});

		const initialRect = clampNormalizedSquareRect(createChipBounds(), IMAGE_ASPECT_RATIO);
		const expectedMove = translateChipBounds(initialRect, { x: 0.1, y: 0.1 }, IMAGE_ASPECT_RATIO);
		const body = screen.getByTestId('localize-box-body');

		await act(async () => {
			dispatchPointerEvent(body, 'pointerdown', {
				buttons: 1,
				clientX: 240,
				clientY: 200,
				pointerId: 1,
			});
		});

		await act(async () => {
			dispatchPointerEvent(window, 'pointermove', {
				buttons: 1,
				clientX: 320,
				clientY: 260,
				pointerId: 1,
			});
		});

		expectRectCallCloseTo(onChipBoundsChangeSpy.mock.calls, 0, expectedMove);
		expect(onChipBoundsCancelSpy).not.toHaveBeenCalled();
		expect(onChipBoundsCommitSpy).not.toHaveBeenCalled();

		await act(async () => {
			dispatchPointerEvent(window, 'pointercancel', {
				clientX: 320,
				clientY: 260,
				pointerId: 1,
			});
		});

		expect(onChipBoundsCancelSpy).toHaveBeenCalledTimes(1);
		expect(onChipBoundsCommitSpy).not.toHaveBeenCalled();
	});
});
