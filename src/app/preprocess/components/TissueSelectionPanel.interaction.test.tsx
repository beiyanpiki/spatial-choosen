import { ChakraProvider } from '@chakra-ui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { theme } from '../../../theme';
import type { PreprocessPoint, ProjectedSpot } from '@/types/preprocess';
import { TissueSelectionPanel } from './TissueSelectionPanel';

const PROJECTED_SPOTS: ProjectedSpot[] = [
	{
		id: 'spot-a',
		barcode: 'spot-a',
		arrayRow: 1,
		arrayCol: 1,
		x: 0.25,
		y: 0.25,
		width: 0.2,
		height: 0.2,
		diameterX: 0.2,
		diameterY: 0.2,
	},
];

beforeAll(() => {
	class ResizeObserverMock {
		observe() {}
		disconnect() {}
		unobserve() {}
	}

	class MockImage {
		onload: (() => void) | null = null;
		onerror: (() => void) | null = null;
		width = 100;
		height = 100;

		set src(_value: string) {
			queueMicrotask(() => this.onload?.());
		}
	}

	vi.stubGlobal('ResizeObserver', ResizeObserverMock);
	vi.stubGlobal('Image', MockImage);
	vi.stubGlobal('PointerEvent', MouseEvent);
	vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
		callback(0);
		return 1;
	}));
	vi.stubGlobal('cancelAnimationFrame', vi.fn());

	Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
		configurable: true,
		value: vi.fn(() => null),
	});
	Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', {
		configurable: true,
		value: vi.fn(),
	});
	Object.defineProperty(HTMLCanvasElement.prototype, 'hasPointerCapture', {
		configurable: true,
		value: vi.fn(() => true),
	});
	Object.defineProperty(HTMLCanvasElement.prototype, 'releasePointerCapture', {
		configurable: true,
		value: vi.fn(),
	});
	Object.defineProperty(HTMLDivElement.prototype, 'getBoundingClientRect', {
		configurable: true,
		value: () => ({
			width: 400,
			height: 300,
			left: 0,
			top: 0,
			right: 400,
			bottom: 300,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		}),
	});
});

const renderPanel = (callbacks: {
	readonly onEditCommit: ReturnType<typeof vi.fn<(editArea: PreprocessPoint[]) => void>>;
	readonly onSpotToggle: ReturnType<typeof vi.fn<(spotId: string) => void>>;
}) => {
	const panelProps = {
		eosinCropDataUrl: 'data:image/png;base64,AA==',
		projectedSpots: PROJECTED_SPOTS,
		selectedSpotIds: [],
		onEditCommit: callbacks.onEditCommit,
		onSpotToggle: callbacks.onSpotToggle,
	};

	render(
		<ChakraProvider theme={theme}>
			<TissueSelectionPanel {...panelProps} />
		</ChakraProvider>,
	);

	const canvas = screen.getByTestId('tissue-stage-canvas').querySelector('canvas');
	expect(canvas).toBeInstanceOf(HTMLCanvasElement);
	return canvas;
};

describe('TissueSelectionPanel pointer interaction', () => {
	it('toggles the clicked spot without committing a lasso', () => {
		const onEditCommit = vi.fn<(editArea: PreprocessPoint[]) => void>();
		const onSpotToggle = vi.fn<(spotId: string) => void>();
		const canvas = renderPanel({ onEditCommit, onSpotToggle });
		if (!(canvas instanceof HTMLCanvasElement)) return;

		fireEvent.pointerDown(canvas, { button: 0, clientX: 125, clientY: 75, pointerId: 1 });
		fireEvent.pointerUp(canvas, { button: 0, clientX: 125, clientY: 75, pointerId: 1 });

		expect(onSpotToggle).toHaveBeenCalledTimes(1);
		expect(onSpotToggle).toHaveBeenCalledWith('spot-a');
		expect(onEditCommit).not.toHaveBeenCalled();
	});

	it('treats sub-threshold pointer jitter as a click', () => {
		const onEditCommit = vi.fn<(editArea: PreprocessPoint[]) => void>();
		const onSpotToggle = vi.fn<(spotId: string) => void>();
		const canvas = renderPanel({ onEditCommit, onSpotToggle });
		if (!(canvas instanceof HTMLCanvasElement)) return;

		fireEvent.pointerDown(canvas, { button: 0, clientX: 125, clientY: 75, pointerId: 1 });
		fireEvent.pointerMove(canvas, { button: 0, clientX: 127, clientY: 76, pointerId: 1 });
		fireEvent.pointerUp(canvas, { button: 0, clientX: 127, clientY: 76, pointerId: 1 });

		expect(onSpotToggle).toHaveBeenCalledWith('spot-a');
		expect(onEditCommit).not.toHaveBeenCalled();
	});

	it('does not toggle after pointer cancellation', () => {
		const onEditCommit = vi.fn<(editArea: PreprocessPoint[]) => void>();
		const onSpotToggle = vi.fn<(spotId: string) => void>();
		const canvas = renderPanel({ onEditCommit, onSpotToggle });
		if (!(canvas instanceof HTMLCanvasElement)) return;

		fireEvent.pointerDown(canvas, { button: 0, clientX: 125, clientY: 75, pointerId: 1 });
		fireEvent.pointerCancel(canvas, { button: 0, clientX: 125, clientY: 75, pointerId: 1 });

		expect(onSpotToggle).not.toHaveBeenCalled();
		expect(onEditCommit).not.toHaveBeenCalled();
	});

	it('ignores non-primary clicks', () => {
		const onEditCommit = vi.fn<(editArea: PreprocessPoint[]) => void>();
		const onSpotToggle = vi.fn<(spotId: string) => void>();
		const canvas = renderPanel({ onEditCommit, onSpotToggle });
		if (!(canvas instanceof HTMLCanvasElement)) return;

		fireEvent.pointerDown(canvas, { button: 2, clientX: 125, clientY: 75, pointerId: 1 });
		fireEvent.pointerUp(canvas, { button: 2, clientX: 125, clientY: 75, pointerId: 1 });

		expect(onSpotToggle).not.toHaveBeenCalled();
		expect(onEditCommit).not.toHaveBeenCalled();
	});

	it('does not toggle when a captured drag moves outside the image', () => {
		const onEditCommit = vi.fn<(editArea: PreprocessPoint[]) => void>();
		const onSpotToggle = vi.fn<(spotId: string) => void>();
		const canvas = renderPanel({ onEditCommit, onSpotToggle });
		if (!(canvas instanceof HTMLCanvasElement)) return;

		fireEvent.pointerDown(canvas, { button: 0, clientX: 125, clientY: 75, pointerId: 1 });
		fireEvent.pointerMove(canvas, { button: 0, clientX: 450, clientY: 75, pointerId: 1 });
		fireEvent.pointerUp(canvas, { button: 0, clientX: 450, clientY: 75, pointerId: 1 });

		expect(onSpotToggle).not.toHaveBeenCalled();
	});

	it('uses pointer-up displacement when no move event is delivered', () => {
		const onEditCommit = vi.fn<(editArea: PreprocessPoint[]) => void>();
		const onSpotToggle = vi.fn<(spotId: string) => void>();
		const canvas = renderPanel({ onEditCommit, onSpotToggle });
		if (!(canvas instanceof HTMLCanvasElement)) return;

		fireEvent.pointerDown(canvas, { button: 0, clientX: 125, clientY: 75, pointerId: 1 });
		fireEvent.pointerUp(canvas, { button: 0, clientX: 450, clientY: 75, pointerId: 1 });

		expect(onSpotToggle).not.toHaveBeenCalled();
	});

	it('commits a dragged lasso without toggling a spot', () => {
		const onEditCommit = vi.fn<(editArea: PreprocessPoint[]) => void>();
		const onSpotToggle = vi.fn<(spotId: string) => void>();
		const canvas = renderPanel({ onEditCommit, onSpotToggle });
		if (!(canvas instanceof HTMLCanvasElement)) return;

		fireEvent.pointerDown(canvas, { button: 0, clientX: 125, clientY: 75, pointerId: 1 });
		fireEvent.pointerMove(canvas, { button: 0, clientX: 175, clientY: 75, pointerId: 1 });
		fireEvent.pointerMove(canvas, { button: 0, clientX: 175, clientY: 125, pointerId: 1 });
		fireEvent.pointerUp(canvas, { button: 0, clientX: 125, clientY: 125, pointerId: 1 });

		expect(onEditCommit).toHaveBeenCalledTimes(1);
		expect(onSpotToggle).not.toHaveBeenCalled();
	});
});
