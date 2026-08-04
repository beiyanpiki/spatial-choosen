import { ChakraProvider } from '@chakra-ui/react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { theme } from '../../../theme';
import type { ChipPlacement, ProjectedSpot } from '@/types/built-in';
import { TissueSelectionPanel } from './TissueSelectionPanel';

// Transform geometry (host rect 400x300, square MockImage -> ratio 1):
//   computeBaseView -> viewX=50, viewY=0, width=300, height=300.
//   HE [0,1] maps to canvas local [50,350] x [0,300].
// With heWidth/heHeight = 1000 and placement {x:200, y:200, size:600}:
//   HE (200,200) -> canvas (110, 60)   [tl corner]
//   HE (800,800) -> canvas (290, 240)  [br corner]
//   HE (500,500) -> canvas (200, 150)  [center of grid body]
const PLACEMENT: ChipPlacement = { x: 200, y: 200, size: 600 };

const PROJECTED_SPOTS: ProjectedSpot[] = [
	{
		id: '1:1',
		barcode: '1:1',
		arrayRow: 1,
		arrayCol: 1,
		x: 0.3,
		y: 0.3,
		width: 0.2,
		height: 0.2,
		diameterX: 0.2,
		diameterY: 0.2,
	},
];

const strokeRectMock = vi.fn();
const fillRectMock = vi.fn();
const drawImageMock = vi.fn();
const clearRectMock = vi.fn();
const beginPathMock = vi.fn();
const arcMock = vi.fn();
const fillMock = vi.fn();
const strokeMock = vi.fn();

const contextStub = {
	clearRect: clearRectMock,
	drawImage: drawImageMock,
	fillRect: fillRectMock,
	strokeRect: strokeRectMock,
	beginPath: beginPathMock,
	moveTo: vi.fn(),
	lineTo: vi.fn(),
	arc: arcMock,
	fill: fillMock,
	stroke: strokeMock,
	fillStyle: '',
	strokeStyle: '',
	lineWidth: 1,
};

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
		naturalWidth = 100;
		naturalHeight = 100;

		set src(_value: string) {
			queueMicrotask(() => {
				this.onload?.();
			});
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
		value: vi.fn(() => contextStub),
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

afterEach(() => {
	cleanup();
	strokeRectMock.mockClear();
	fillRectMock.mockClear();
	drawImageMock.mockClear();
	clearRectMock.mockClear();
	beginPathMock.mockClear();
	arcMock.mockClear();
	fillMock.mockClear();
	strokeMock.mockClear();
	contextStub.fillStyle = '';
	contextStub.strokeStyle = '';
	contextStub.lineWidth = 1;
});

const renderPanel = (onPlacementChange: (placement: ChipPlacement) => void) => {
	render(
		<ChakraProvider theme={theme}>
			<TissueSelectionPanel
				imageDataUrl='data:image/png;base64,AA=='
				projectedSpots={PROJECTED_SPOTS}
				selectedSpotIds={[]}
				placement={PLACEMENT}
				heWidth={1000}
				heHeight={1000}
				onPlacementChange={onPlacementChange}
			/>
		</ChakraProvider>,
	);

	const canvas = screen.getByTestId('tissue-stage-canvas').querySelector('canvas');
	expect(canvas).toBeInstanceOf(HTMLCanvasElement);
	return canvas;
};

describe('TissueSelectionPanel pointer interaction', () => {
	it('renders the placement outline without crashing', async () => {
		const canvas = renderPanel(vi.fn());
		if (!(canvas instanceof HTMLCanvasElement)) return;

		await waitFor(() => {
			expect(strokeRectMock).toHaveBeenCalled();
		});
	});

	it('moves the placement when dragging inside the grid body', async () => {
		const onPlacementChange = vi.fn();
		const canvas = renderPanel(onPlacementChange);
		if (!(canvas instanceof HTMLCanvasElement)) return;

		// Wait until the host rect + image have resolved and the grid has been drawn.
		await waitFor(() => {
			expect(strokeRectMock).toHaveBeenCalled();
		});

		// Center of the placement square (HE 500,500 -> canvas 200,150), inside the body
		// and far from any corner handle.
		fireEvent.pointerDown(canvas, { button: 0, clientX: 200, clientY: 150, pointerId: 1 });
		// Drag right by 30 canvas px -> HE dx = (30/300)*1000 = 100 HE px.
		fireEvent.pointerMove(canvas, { button: 0, clientX: 230, clientY: 150, pointerId: 1 });
		fireEvent.pointerUp(canvas, { button: 0, clientX: 230, clientY: 150, pointerId: 1 });

		expect(onPlacementChange).toHaveBeenCalledWith(
			expect.objectContaining({ x: 300, y: 200, size: 600 }),
		);
		const moved = onPlacementChange.mock.calls[0]?.[0] as ChipPlacement | undefined;
		expect(moved).toBeDefined();
		expect(moved!.x).not.toBe(PLACEMENT.x);
		expect(moved!.size).toBe(PLACEMENT.size);
	});

	it('resizes the placement when dragging from a corner handle', async () => {
		const onPlacementChange = vi.fn();
		const canvas = renderPanel(onPlacementChange);
		if (!(canvas instanceof HTMLCanvasElement)) return;

		await waitFor(() => {
			expect(strokeRectMock).toHaveBeenCalled();
		});

		// Bottom-right corner (HE 800,800 -> canvas 290,240), within the 12px handle radius.
		fireEvent.pointerDown(canvas, { button: 0, clientX: 290, clientY: 240, pointerId: 1 });
		// Drag inward; new dragged corner HE ~(700,700) -> size = max(500,500) = 500.
		fireEvent.pointerMove(canvas, { button: 0, clientX: 260, clientY: 210, pointerId: 1 });
		fireEvent.pointerUp(canvas, { button: 0, clientX: 260, clientY: 210, pointerId: 1 });

		expect(onPlacementChange).toHaveBeenCalledWith(
			expect.objectContaining({ x: 200, y: 200, size: 500 }),
		);
		const resized = onPlacementChange.mock.calls[0]?.[0] as ChipPlacement | undefined;
		expect(resized).toBeDefined();
		expect(resized!.size).not.toBe(PLACEMENT.size);
	});

	it('resizes the placement when dragging from an edge', async () => {
		const onPlacementChange = vi.fn();
		const canvas = renderPanel(onPlacementChange);
		if (!(canvas instanceof HTMLCanvasElement)) return;

		await waitFor(() => {
			expect(strokeRectMock).toHaveBeenCalled();
		});

		// Top edge midpoint (HE 500,200 -> canvas 200,60): within the 8px edge
		// band and far from the corner handles.
		fireEvent.pointerDown(canvas, { button: 0, clientX: 200, clientY: 60, pointerId: 1 });
		// Drag the top edge upward to HE y=100 (canvas 30); the bottom edge stays
		// fixed and the box stays square, so size grows to 700.
		fireEvent.pointerMove(canvas, { button: 0, clientX: 200, clientY: 30, pointerId: 1 });
		fireEvent.pointerUp(canvas, { button: 0, clientX: 200, clientY: 30, pointerId: 1 });

		expect(onPlacementChange).toHaveBeenCalledWith(
			expect.objectContaining({ x: 150, y: 100, size: 700 }),
		);
		const resized = onPlacementChange.mock.calls[0]?.[0] as ChipPlacement | undefined;
		expect(resized).toBeDefined();
		expect(resized!.size).toBeGreaterThan(PLACEMENT.size);
	});
});
