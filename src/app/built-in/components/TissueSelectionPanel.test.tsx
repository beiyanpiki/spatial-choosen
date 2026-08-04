import { ChakraProvider } from '@chakra-ui/react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { theme } from '../../../theme';
import { colorForLabel } from '../../../lib/colors';
import { TissueSelectionPanel } from './TissueSelectionPanel';

const requestAnimationFrameMock = vi.fn<(callback: FrameRequestCallback) => number>((callback) => {
	callback(0);
	return 1;
});
const cancelAnimationFrameMock = vi.fn();
const drawImageMock = vi.fn();
const clearRectMock = vi.fn();
const fillRectMock = vi.fn();
const strokeRectMock = vi.fn();
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

	vi.stubGlobal('ResizeObserver', ResizeObserverMock);
	vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
	vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock);

	Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
		configurable: true,
		value: vi.fn(() => contextStub),
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

	vi.stubGlobal('Image', MockImage);
});

afterEach(() => {
	cleanup();
	requestAnimationFrameMock.mockClear();
	cancelAnimationFrameMock.mockClear();
	drawImageMock.mockClear();
	clearRectMock.mockClear();
	fillRectMock.mockClear();
	strokeRectMock.mockClear();
	beginPathMock.mockClear();
	arcMock.mockClear();
	fillMock.mockClear();
	strokeMock.mockClear();
	contextStub.fillStyle = '';
	contextStub.strokeStyle = '';
	contextStub.lineWidth = 1;
});

describe('TissueSelectionPanel', () => {
	it('renders the placement grid with colored spots and the active-spot count', async () => {
		const assignedFill = colorForLabel(1).toLowerCase();
		const expectedAssignedFill = `${assignedFill}40`;
		const expectedNeutralFill = '#e5e5e520';
		const fillStyles: string[] = [];

		fillRectMock.mockImplementation(() => {
			fillStyles.push(String(contextStub.fillStyle).toLowerCase());
		});

		render(
			<ChakraProvider theme={theme}>
				<TissueSelectionPanel
					imageDataUrl='data:image/png;base64,AA=='
					projectedSpots={[
						{
							id: '1:1',
							barcode: '1:1',
							arrayRow: 1,
							arrayCol: 1,
							x: 0.25,
							y: 0.25,
							width: 0.2,
							height: 0.2,
							diameterX: 0.2,
							diameterY: 0.2,
						},
						{
							id: '1:2',
							barcode: '1:2',
							arrayRow: 1,
							arrayCol: 2,
							x: 0.75,
							y: 0.25,
							width: 0.2,
							height: 0.2,
							diameterX: 0.2,
							diameterY: 0.2,
						},
					]}
					selectedSpotIds={['1:1']}
					placement={{ x: 0, y: 0, size: 1000 }}
					heWidth={1000}
					heHeight={1000}
					onPlacementChange={vi.fn()}
				/>
			</ChakraProvider>,
		);

		await waitFor(() => {
			expect(fillStyles).toContain(expectedAssignedFill);
			expect(fillStyles).toContain(expectedNeutralFill);
		});

		// The placement outline square is drawn on top of the spots.
		expect(strokeRectMock).toHaveBeenCalled();

		expect(screen.getByText('Chip grid placement')).toBeInTheDocument();
		expect(screen.getByTestId('tissue-panel-selected-count')).toHaveTextContent('Active spots: 1');
	});

	it('skips spot drawing when spot visibility is turned off but still draws the placement outline', async () => {
		render(
			<ChakraProvider theme={theme}>
				<TissueSelectionPanel
					imageDataUrl='data:image/png;base64,AA=='
					projectedSpots={[
						{
							id: '1:1',
							barcode: '1:1',
							arrayRow: 1,
							arrayCol: 1,
							x: 0.25,
							y: 0.25,
							width: 0.2,
							height: 0.2,
							diameterX: 0.2,
							diameterY: 0.2,
						},
					]}
					selectedSpotIds={['1:1']}
					placement={{ x: 0, y: 0, size: 1000 }}
					heWidth={1000}
					heHeight={1000}
					showSpots={false}
					onPlacementChange={vi.fn()}
				/>
			</ChakraProvider>,
		);

		await waitFor(() => {
			expect(drawImageMock).toHaveBeenCalled();
		});

		expect(fillRectMock).not.toHaveBeenCalled();
	});
});
