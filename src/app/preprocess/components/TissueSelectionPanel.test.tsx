import { ChakraProvider } from '@chakra-ui/react';
import { cleanup, render, waitFor } from '@testing-library/react';
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
const moveToMock = vi.fn();
const lineToMock = vi.fn();
const strokeMock = vi.fn();

const contextStub = {
	clearRect: clearRectMock,
	drawImage: drawImageMock,
	fillRect: fillRectMock,
	strokeRect: strokeRectMock,
	beginPath: beginPathMock,
	moveTo: moveToMock,
	lineTo: lineToMock,
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

	HTMLCanvasElement.prototype.getContext = vi.fn(() => contextStub) as typeof HTMLCanvasElement.prototype.getContext;

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
	moveToMock.mockClear();
	lineToMock.mockClear();
	strokeMock.mockClear();
	contextStub.fillStyle = '';
	contextStub.strokeStyle = '';
	contextStub.lineWidth = 1;
});

describe('TissueSelectionPanel', () => {
	it('renders active and inactive spots with spatial overlay colors', async () => {
		const assignedFill = colorForLabel(1).toLowerCase();
		const expectedAssignedFill = `${assignedFill}59`;
		const expectedAssignedStroke = '#1a202c8c';
		const expectedNeutralFill = '#e5e5e533';
		const expectedNeutralStroke = '#a0a0a059';
		const fillStyles: string[] = [];
		const strokeStyles: string[] = [];

		fillRectMock.mockImplementation(() => {
			fillStyles.push(String(contextStub.fillStyle).toLowerCase());
		});
		strokeRectMock.mockImplementation(() => {
			strokeStyles.push(String(contextStub.strokeStyle).toLowerCase());
		});

		render(
			<ChakraProvider theme={theme}>
				<TissueSelectionPanel
					eosinCropDataUrl='data:image/png;base64,AA=='
					projectedSpots={[
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
						{
							id: 'spot-b',
							barcode: 'spot-b',
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
					selectedSpotIds={['spot-a']}
				/>
			</ChakraProvider>,
		);

		await waitFor(() => {
			expect(fillStyles).toContain(expectedAssignedFill);
			expect(fillStyles).toContain(expectedNeutralFill);
			expect(strokeStyles).toContain(expectedAssignedStroke);
			expect(strokeStyles).toContain(expectedNeutralStroke);
		});
	});

	it('skips spot drawing when spot visibility is turned off', async () => {
		render(
			<ChakraProvider theme={theme}>
				<TissueSelectionPanel
					eosinCropDataUrl='data:image/png;base64,AA=='
					projectedSpots={[
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
					]}
					selectedSpotIds={['spot-a']}
					showSpots={false}
				/>
			</ChakraProvider>,
		);

		await waitFor(() => {
			expect(drawImageMock).toHaveBeenCalled();
		});

		expect(fillRectMock).not.toHaveBeenCalled();
		expect(strokeRectMock).not.toHaveBeenCalled();
	});
});
