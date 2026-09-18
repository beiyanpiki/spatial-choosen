import { ChakraProvider } from '@chakra-ui/react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { theme } from '@/theme';

import { BatchRegionStage } from './BatchRegionStage';

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  // jsdom ships no PointerEvent implementation.
  vi.stubGlobal('PointerEvent', MouseEvent);
});

type RecordingContext = {
  [key: string]: unknown;
  stroke: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
};

let context: RecordingContext | null = null;

const installContext = () => {
  context = {
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  };

  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => context),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: vi.fn(() => true),
  });

  // jsdom lays every element out at 0x0, which would make every pointer
  // position fall outside the stage.
  Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 900,
  });
  Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 700,
  });
  Object.defineProperty(HTMLDivElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 900,
      height: 700,
      left: 0,
      top: 0,
      right: 900,
      bottom: 700,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });

  return context as RecordingContext;
};

beforeEach(() => {
  installContext();
});

const renderStage = () => render(
  <ChakraProvider theme={theme}>
    <BatchRegionStage
      title='250926-SPA-GW1'
      description='Confirm the projected region.'
      imageUrl={null}
      imageSize={{ width: 2884, height: 2884 }}
      regions={[]}
      testIdPrefix='batch-region'
    />
  </ChakraProvider>,
);

const renderLockedStage = () => render(
  <ChakraProvider theme={theme}>
    <BatchRegionStage
      title='250926-SPA-GW1'
      description='Locked reference view.'
      imageUrl={null}
      imageSize={{ width: 2884, height: 2884 }}
      regions={[]}
      locked
      interactive={false}
      testIdPrefix='batch-reference'
    />
  </ChakraProvider>,
);

const SPOTS = [
  { barcode: 'b1', inTissue: true, arrayRow: 1, arrayCol: 1, pxlRowInFullres: 400, pxlColInFullres: 400 },
  { barcode: 'b2', inTissue: true, arrayRow: 1, arrayCol: 2, pxlRowInFullres: 400, pxlColInFullres: 440 },
  { barcode: 'b3', inTissue: true, arrayRow: 1, arrayCol: 3, pxlRowInFullres: 400, pxlColInFullres: 480 },
];

const renderStageWithSpots = () => render(
  <ChakraProvider theme={theme}>
    <BatchRegionStage
      title='260206-SPA-K507'
      description='Draw the tissue area.'
      imageUrl={null}
      imageSize={{ width: 2884, height: 2884 }}
      regions={[]}
      spots={SPOTS}
      selectedBarcodeSet={new Set(['b1'])}
      spotDiameterFullres={20}
      testIdPrefix='batch-region'
    />
  </ChakraProvider>,
);

const wheel = (target: Element, deltaY: number) => {
  const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

describe('BatchRegionStage wheel handling', () => {
  it('keeps the wheel to the page when the panel is a locked reference', () => {
    renderLockedStage();

    const event = wheel(screen.getByTestId('batch-reference-surface'), -100);

    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('button', { name: 'Fit' })).not.toBeInTheDocument();
    expect(screen.getByText('Fixed reference view')).toBeInTheDocument();
  });

  it('zooms the image and suppresses page scrolling while the pointer is over the image', () => {
    renderStage();

    const surface = screen.getByTestId('batch-region-surface');
    expect(screen.getByTestId('batch-region-zoom')).toHaveTextContent('100%');

    const event = wheel(surface, -100);

    // Registered non-passively, otherwise the page keeps scrolling behind the canvas.
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByTestId('batch-region-zoom')).toHaveTextContent('110%');
  });

  it('zooms back out on a downward wheel', () => {
    renderStage();

    const surface = screen.getByTestId('batch-region-surface');
    wheel(surface, -100);
    wheel(surface, -100);
    wheel(surface, 100);

    // 1 -> 1.1 -> 1.21 -> 1.089
    expect(screen.getByTestId('batch-region-zoom')).toHaveTextContent('109%');
  });

  it('restores the fitted view through the Fit control', () => {
    renderStage();

    const surface = screen.getByTestId('batch-region-surface');
    wheel(surface, -100);
    expect(screen.getByTestId('batch-region-zoom')).not.toHaveTextContent('100%');

    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));

    expect(screen.getByTestId('batch-region-zoom')).toHaveTextContent('100%');
  });
});

describe('BatchRegionStage live stroke rendering', () => {
  it('draws the in-progress stroke before the pointer is released', async () => {
    const ctx = installContext();
    renderStage();

    const surface = screen.getByTestId('batch-region-surface');
    ctx.stroke.mockClear();

    // The fitted stage occupies x/y 100..800 inside the 900x700 host.
    fireEvent.pointerDown(surface, { button: 0, clientX: 250, clientY: 250, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 320, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 360, clientY: 380, pointerId: 1 });

    // The path is still open here: nothing has been committed yet, so any
    // stroke call comes from the live preview.
    await waitFor(() => expect(ctx.stroke).toHaveBeenCalled());
    expect(ctx.lineTo).toHaveBeenCalled();
  });
});

describe('BatchRegionStage spot overlay', () => {
  it('draws selected and unmarked spots by default', () => {
    const ctx = installContext();
    renderStageWithSpots();

    expect(ctx.fillRect).toHaveBeenCalledTimes(SPOTS.length);
  });

  it('hides the grey unmarked spots when the toggle is switched off', () => {
    const ctx = installContext();
    renderStageWithSpots();
    expect(ctx.fillRect).toHaveBeenCalledTimes(SPOTS.length);

    ctx.fillRect.mockClear();
    fireEvent.click(screen.getByTestId('batch-region-unmarked-spots'));

    // Only the single selected barcode keeps its marker.
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
  });

  it('brings the unmarked spots back when toggled on again', () => {
    const ctx = installContext();
    renderStageWithSpots();

    fireEvent.click(screen.getByTestId('batch-region-unmarked-spots'));
    ctx.fillRect.mockClear();
    fireEvent.click(screen.getByTestId('batch-region-unmarked-spots'));

    expect(ctx.fillRect).toHaveBeenCalledTimes(SPOTS.length);
  });

  it('hides every marker when the spot overlay itself is off', () => {
    const ctx = installContext();
    renderStageWithSpots();

    ctx.fillRect.mockClear();
    fireEvent.click(screen.getByTestId('batch-region-spot-overlay'));

    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});
