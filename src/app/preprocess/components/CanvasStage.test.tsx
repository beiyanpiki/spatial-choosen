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
		width = 400;
		height = 300;
		naturalWidth = 400;
		naturalHeight = 300;

		set src(_value: string) {
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

const readChipBounds = () => JSON.parse(screen.getByTestId('stage-chip-bounds').textContent ?? 'null') as PreprocessRect;

const readTransform = () => JSON.parse(screen.getByTestId('stage-transform').textContent ?? 'null') as LocalizationImageTransform;

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
	onChipBoundsChangeSpy,
	onChipBoundsCancelSpy,
	onChipBoundsCommitSpy,
}: {
	onChipBoundsChangeSpy: (bounds: PreprocessRect) => void;
	onChipBoundsCancelSpy?: () => void;
	onChipBoundsCommitSpy: (bounds: PreprocessRect) => void;
}) {
	const [chipBounds, setChipBounds] = useState<PreprocessRect>(createChipBounds());

	return (
		<ChakraProvider theme={theme}>
			<CanvasStage
				boxColor="green"
				chipBounds={chipBounds}
				controlTestIdPrefix="localize"
				image={createImage()}
				imageTransform={createTransform()}
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
	it('keeps overlay coordinates fixed across rotation and a flip state', async () => {
		render(<StageHarness />);

		await waitFor(() => {
			expect(screen.getByTestId('localize-box-outline')).toBeInTheDocument();
		});

		const initialPoints = readOutlinePoints();

		fireEvent.click(screen.getByTestId('localize-stage-rotate-right-90'));

		await waitFor(() => {
			expect(readTransform()).toMatchObject({ rotationDegrees: 90 });
		});
		expect(readOutlinePoints()).toEqual(initialPoints);

		fireEvent.click(screen.getByTestId('localize-stage-flip-horizontal'));

		await waitFor(() => {
			expect(readTransform()).toMatchObject({ flipHorizontal: true });
		});
		expect(readOutlinePoints()).toEqual(initialPoints);
	});

	it('preserves move, resize, and direct rotation control behavior after rotation', async () => {
		render(<StageHarness />);

		await waitFor(() => {
			expect(screen.getByTestId('localize-box-outline')).toBeInTheDocument();
		});

		const initialRect = clampNormalizedSquareRect(createChipBounds(), IMAGE_ASPECT_RATIO);
		const initialOutline = readOutlinePoints();
		expect(initialOutline).toEqual([
			[160, 120],
			[320, 120],
			[320, 280],
			[160, 280],
		]);

		fireEvent.click(screen.getByTestId('localize-stage-rotate-right-90'));

		await waitFor(() => {
			expect(readTransform()).toMatchObject({ rotationDegrees: 90 });
		});
		expect(readOutlinePoints()).toEqual(initialOutline);

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
				clientX: 520,
				clientY: 300,
				pointerId: 1,
			});
			dispatchPointerEvent(window, 'pointerup', {
				clientX: 520,
				clientY: 300,
				pointerId: 1,
			});
		});

		const movedRect = translateChipBounds(initialRect, { x: 0.35, y: 1 / 6 }, IMAGE_ASPECT_RATIO);
		await waitFor(() => {
			expect(readChipBounds()).toEqual(movedRect);
		});

		const eastHandle = screen.getByTestId('localize-box-handle-e');
		await act(async () => {
			dispatchPointerEvent(eastHandle, 'pointerdown', {
				buttons: 1,
				clientX: 400,
				clientY: 200,
				pointerId: 1,
			});
		});
		await act(async () => {
			dispatchPointerEvent(window, 'pointermove', {
				buttons: 1,
				clientX: 480,
				clientY: 200,
				pointerId: 1,
			});
			dispatchPointerEvent(window, 'pointerup', {
				clientX: 480,
				clientY: 200,
				pointerId: 1,
			});
		});

		const resizedRect = resizeChipBounds(movedRect, 'e', { x: 0.6, y: 1 / 3 }, IMAGE_ASPECT_RATIO);
		await waitFor(() => {
			expect(readChipBounds()).toEqual(resizedRect);
		});
	});

	it('lets the real rotation handle change rotation without drifting overlay geometry or saved bounds', async () => {
		render(<StageHarness />);

		await waitFor(() => {
			expect(screen.getByTestId('localize-box-outline')).toBeInTheDocument();
		});

		const initialOutline = readOutlinePoints();
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
		expect(readOutlinePoints()).toEqual(initialOutline);
		expect(readChipBounds()).toEqual(initialBounds);
	});

	it('emits live drag updates on pointermove and a single final bounds commit on pointerup', async () => {
		const onChipBoundsChangeSpy = vi.fn();
		const onChipBoundsCommitSpy = vi.fn();

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
		expect(onChipBoundsChangeSpy).toHaveBeenNthCalledWith(1, expectedFirstMove);
		expect(onChipBoundsChangeSpy).toHaveBeenNthCalledWith(2, expectedFinalMove);
		expect(onChipBoundsCommitSpy).not.toHaveBeenCalled();

		await act(async () => {
			dispatchPointerEvent(window, 'pointerup', {
				clientX: 520,
				clientY: 300,
				pointerId: 1,
			});
		});

		expect(onChipBoundsCommitSpy).toHaveBeenCalledTimes(1);
		expect(onChipBoundsCommitSpy).toHaveBeenCalledWith(expectedFinalMove);
	});

	it('clears drag state through the cancel callback without committing bounds', async () => {
		const onChipBoundsChangeSpy = vi.fn();
		const onChipBoundsCancelSpy = vi.fn();
		const onChipBoundsCommitSpy = vi.fn();

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

		expect(onChipBoundsChangeSpy).toHaveBeenCalledWith(expectedMove);
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
