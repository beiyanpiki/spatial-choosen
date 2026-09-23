import { ChakraProvider } from '@chakra-ui/react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { BATCH_REGION_COLORS, createRegionColor } from '@/lib/batch/regionColors';
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

  class MockImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 1600;
    naturalHeight = 1600;
    width = 1600;
    height = 1600;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }

  vi.stubGlobal('Image', MockImage);
});

type RecordingContext = {
  [key: string]: unknown;
  stroke: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
  /** Every colour the draw loop painted with, in order. */
  fillStyles: string[];
};

let context: RecordingContext | null = null;

const installContext = () => {
  const fillStyles: string[] = [];
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
    fillStyles,
  };
  // A plain property would swallow the writes, so keep every colour that the
  // spot overlay paints with.
  Object.defineProperty(context, 'fillStyle', {
    configurable: true,
    get: () => fillStyles[fillStyles.length - 1] ?? '',
    set: (value: string) => {
      fillStyles.push(value);
    },
  });

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

describe('BatchRegionStage tissue-table comparison', () => {
  const renderComparison = () => render(
    <ChakraProvider theme={theme}>
      <BatchRegionStage
        title='260206-SPA-K507'
        description='Compare with the tissue table.'
        imageUrl={null}
        imageSize={{ width: 2884, height: 2884 }}
        regions={[]}
        spots={SPOTS}
        // b1 is inside the drawn region, b2 was kept by the table, b3 neither.
        selectedBarcodeSet={new Set(['b1'])}
        comparisonBarcodes={new Set(['b2'])}
        spotDiameterFullres={20}
        testIdPrefix='batch-compare'
      />
    </ChakraProvider>,
  );

  it('splits the overlay into kept-before, drawn-now and their overlap', () => {
    const ctx = installContext();
    const before = ctx.fillStyles.length;
    renderComparison();

    const painted = ctx.fillStyles.slice(before);

    // Only the spot kept by the table (amber) and the one inside the region
    // (blue) are marked; the untouched grey spot is left out.
    expect(painted).toContain('rgba(214, 158, 46, 0.75)');
    expect(painted).toContain('rgba(49, 130, 206, 0.75)');
    expect(painted).not.toContain('rgba(70, 70, 70, 0.55)');
    expect(ctx.fillRect).toHaveBeenCalledTimes(2);
  });

  it('reports the comparison in the legend', () => {
    renderComparison();

    expect(screen.getByTestId('batch-compare-compare-legend')).toBeInTheDocument();
    expect(screen.getByTestId('batch-compare-compare-both')).toHaveTextContent('0');
    expect(screen.getByTestId('batch-compare-compare-previous-only')).toHaveTextContent('1');
    expect(screen.getByTestId('batch-compare-compare-current-only')).toHaveTextContent('1');
  });

  it('does not show the legend without a comparison set', () => {
    renderStageWithSpots();

    expect(screen.queryByTestId('batch-region-compare-legend')).not.toBeInTheDocument();
  });
});

describe('BatchRegionStage colour groups', () => {
  const renderGroups = (options: {
    onRenameColor?: (colorId: number, name: string) => void;
  } = {}) => render(
    <ChakraProvider theme={theme}>
      <BatchRegionStage
        title='260206-SPA-K507'
        description='Colour groups.'
        imageUrl={null}
        imageSize={{ width: 6296, height: 6296 }}
        regions={[]}
        colors={BATCH_REGION_COLORS}
        onRenameColor={options.onRenameColor}
        onUndoRegion={vi.fn()}
        testIdPrefix='batch-groups'
      />
    </ChakraProvider>,
  );

  it('lists the colour groups instead of a per-polygon region list', () => {
    renderGroups();

    expect(screen.getByText('Colours')).toBeInTheDocument();
    expect(screen.getByTestId('batch-groups-group-1')).toHaveTextContent('Group 1');
    expect(screen.getByTestId('batch-groups-group-5')).toHaveTextContent('Group 5');
  });

  it('renames a group through the inline editor', () => {
    const onRenameColor = vi.fn();
    renderGroups({ onRenameColor });

    fireEvent.click(screen.getByTestId('batch-groups-rename-2'));
    const input = screen.getByTestId('batch-groups-group-name-2');
    fireEvent.change(input, { target: { value: 'Tumour' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRenameColor).toHaveBeenCalledWith(2, 'Tumour');
    // The editor closes again.
    expect(screen.queryByTestId('batch-groups-group-name-2')).not.toBeInTheDocument();
  });

  it('hides the rename control when the owner cannot store names', () => {
    renderGroups();

    expect(screen.queryByTestId('batch-groups-rename-1')).not.toBeInTheDocument();
  });
});

describe('BatchRegionStage trimmed view', () => {
  it('scales an aligned image to the trimmed view, not to the frame pixel count', async () => {
    const ctx = installContext();
    render(
      <ChakraProvider theme={theme}>
        <BatchRegionStage
          title='260206-SPA-K507'
          description='Aligned and trimmed.'
          imageUrl='blob:preview'
          imageSize={{ width: 6296, height: 6296 }}
          frame={{
            size: { width: 6296, height: 6296 },
            // A 1600px preview covering a 6296px frame, as produced by the importer.
            previewToFrame: [6296 / 1600, 0, 0, 0, 6296 / 1600, 0],
            fullresToFrame: [1, 0, 0, 0, 1, 0],
          }}
          viewBounds={{ x: 0.2, y: 0.23, width: 0.66, height: 0.45 }}
          regions={[]}
          testIdPrefix='batch-region'
        />
      </ChakraProvider>,
    );

    await waitFor(() => expect(ctx.drawImage).toHaveBeenCalled());

    // The last transform before drawImage is the one the image is drawn with.
    const matrix = ctx.setTransform.mock.calls.at(-1) as number[];
    const scale = Math.hypot(matrix[0], matrix[1]);

    // A 900x700 host showing 66% x 45% of the frame means roughly 0.85 screen
    // pixels per preview pixel. Treating the normalized bounds as pixels used to
    // multiply this by the frame size, blowing the image up ~4000x.
    expect(scale).toBeGreaterThan(0.1);
    expect(scale).toBeLessThan(5);
  });
});

describe('BatchRegionStage region tools', () => {
  const renderWithHistory = (canUndo: boolean, onUndoRegion = vi.fn()) => {
    render(
      <ChakraProvider theme={theme}>
        <BatchRegionStage
          title='260206-SPA-K507'
          description='Region tools.'
          imageUrl={null}
          imageSize={{ width: 6296, height: 6296 }}
          regions={[]}
          onUndoRegion={onUndoRegion}
          canUndo={canUndo}
          onClearRegions={vi.fn()}
          testIdPrefix='batch-tools'
        />
      </ChakraProvider>,
    );

    return onUndoRegion;
  };

  it('offers Merge and Cut out, and no Delete button', () => {
    renderWithHistory(true);

    expect(screen.getByTestId('batch-tools-tool-merge')).toBeInTheDocument();
    expect(screen.getByTestId('batch-tools-tool-cut')).toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('only enables Undo while the edit history has something to revert', () => {
    const onUndo = renderWithHistory(false);
    const button = screen.getByTestId('batch-tools-undo');

    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('reverts the previous operation through Undo', () => {
    const onUndo = renderWithHistory(true);

    fireEvent.click(screen.getByTestId('batch-tools-undo'));

    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});

describe('BatchRegionStage control panel', () => {
  const renderPanel = () => {
    render(
      <ChakraProvider theme={theme}>
        <BatchRegionStage
          title='260206-SPA-K507'
          description='Movable panel.'
          imageUrl={null}
          imageSize={{ width: 6296, height: 6296 }}
          regions={[]}
          testIdPrefix='batch-panel'
        />
      </ChakraProvider>,
    );

    const handle = screen.getByTestId('batch-panel-panel-handle');
    const panel = handle.closest('div[style*="transform"]') as HTMLElement;
    expect(panel).toBeInstanceOf(HTMLElement);

    // jsdom gives every element the same rect; the panel needs its own size so
    // the drag clamps behave like they do in the browser.
    Object.defineProperty(panel, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        width: 300,
        height: 500,
        left: 600,
        top: 16,
        right: 900,
        bottom: 516,
        x: 600,
        y: 16,
        toJSON: () => ({}),
      }),
    });

    return { handle, panel };
  };

  it('moves out of the way when the handle is dragged', () => {
    const { handle, panel } = renderPanel();
    expect(panel.style.transform).toBe('translate(0px, 0px)');

    fireEvent.pointerDown(handle, { button: 0, clientX: 800, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 680, clientY: 70, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(panel.style.transform).toBe('translate(-120px, 40px)');
  });

  it('snaps back to the corner on double click', () => {
    const { handle, panel } = renderPanel();

    fireEvent.pointerDown(handle, { button: 0, clientX: 800, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 680, clientY: 70, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(panel.style.transform).not.toBe('translate(0px, 0px)');

    fireEvent.doubleClick(handle);

    expect(panel.style.transform).toBe('translate(0px, 0px)');
  });

  it('can be parked outside the image, only the window limits it', () => {
    const { handle, panel } = renderPanel();

    // jsdom's window is 1024x768; the stubbed canvas is 900x700 and the panel
    // sits at x=600, so a +300px drag pushes it past the canvas edge.
    fireEvent.pointerDown(handle, { button: 0, clientX: 800, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 1100, clientY: 630, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(panel.style.transform);
    expect(match).not.toBeNull();

    const [, x, y] = match as RegExpExecArray;
    expect(Number(x)).toBeGreaterThan(100);
    expect(Number(y)).toBeGreaterThan(100);
  });
});

describe('BatchRegionStage controlled view', () => {
  it('reports zoom changes to the owner instead of moving alone', () => {
    const onViewZoomChange = vi.fn();
    render(
      <ChakraProvider theme={theme}>
        <BatchRegionStage
          title='250926-SPA-GW1'
          description='Controlled view.'
          imageUrl={null}
          imageSize={{ width: 2884, height: 2884 }}
          regions={[]}
          viewZoom={1}
          onViewZoomChange={onViewZoomChange}
          testIdPrefix='batch-shared'
        />
      </ChakraProvider>,
    );

    wheel(screen.getByTestId('batch-shared-surface'), -100);

    expect(onViewZoomChange).toHaveBeenCalledTimes(1);
    expect(onViewZoomChange.mock.calls[0][0]).toBeCloseTo(1.1, 6);
    // The panel renders whatever the owner passes, so both panels stay in sync.
    expect(screen.getByTestId('batch-shared-zoom')).toHaveTextContent('100%');
  });
});

describe('BatchRegionStage palette', () => {
  const renderPalette = (options: {
    onAddColor?: (hex: string) => void;
    onClearColors?: () => void;
    colors?: typeof BATCH_REGION_COLORS;
  } = {}) => render(
    <ChakraProvider theme={theme}>
      <BatchRegionStage
        title='260206-SPA-K507'
        description='Palette.'
        imageUrl={null}
        imageSize={{ width: 6296, height: 6296 }}
        regions={[]}
        activeColorId={1}
        onActiveColorChange={vi.fn()}
        colors={options.colors}
        onAddColor={options.onAddColor}
        onClearColors={options.onClearColors}
        testIdPrefix='batch-palette'
      />
    </ChakraProvider>,
  );

  it('only adds the colour when the Add button is pressed', () => {
    const onAddColor = vi.fn();
    renderPalette({ onAddColor });

    expect(screen.getByTestId('batch-palette-add-color')).toBeInTheDocument();
    // The picker stays closed until the plus is used.
    expect(screen.queryByTestId('batch-palette-color-input')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('batch-palette-add-color'));
    const input = screen.getByTestId('batch-palette-color-input');

    // Choosing or dragging inside the picker only stages the colour.
    fireEvent.change(input, { target: { value: '#ff0000' } });
    fireEvent.change(input, { target: { value: '#3366ff' } });
    expect(onAddColor).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('batch-palette-add-color-confirm'));

    expect(onAddColor).toHaveBeenCalledTimes(1);
    expect(onAddColor).toHaveBeenCalledWith('#3366ff');
    // The picker closes again after adding.
    expect(screen.queryByTestId('batch-palette-color-input')).not.toBeInTheDocument();
  });

  it('hides the plus control when the owner cannot store new colours', () => {
    renderPalette();

    expect(screen.queryByTestId('batch-palette-add-color')).not.toBeInTheDocument();
  });

  it('offers to drop added colours once there are any', () => {
    const onClearColors = vi.fn();
    renderPalette({
      onAddColor: vi.fn(),
      onClearColors,
      colors: [...BATCH_REGION_COLORS, createRegionColor(6, '#3366ff')],
    });

    fireEvent.click(screen.getByTestId('batch-palette-clear-colors'));

    expect(onClearColors).toHaveBeenCalledTimes(1);
  });

  it('hides the clear control while only the built-in colours exist', () => {
    renderPalette({ onAddColor: vi.fn(), onClearColors: vi.fn() });

    expect(screen.queryByTestId('batch-palette-clear-colors')).not.toBeInTheDocument();
  });

  it('refuses a colour that is already in the palette', () => {
    const onAddColor = vi.fn();
    const onActiveColorChange = vi.fn();

    render(
      <ChakraProvider theme={theme}>
        <BatchRegionStage
          title='260206-SPA-K507'
          description='Palette.'
          imageUrl={null}
          imageSize={{ width: 6296, height: 6296 }}
          regions={[]}
          activeColorId={1}
          onActiveColorChange={onActiveColorChange}
          onAddColor={onAddColor}
          testIdPrefix='batch-palette'
        />
      </ChakraProvider>,
    );

    fireEvent.click(screen.getByTestId('batch-palette-add-color'));
    // Pick the built-in green again.
    fireEvent.change(screen.getByTestId('batch-palette-color-input'), {
      target: { value: '#38a169' },
    });
    fireEvent.click(screen.getByTestId('batch-palette-add-color-confirm'));

    expect(onAddColor).not.toHaveBeenCalled();
    expect(onActiveColorChange).toHaveBeenCalledWith(3);
    expect(screen.getByTestId('batch-palette-color-notice')).toHaveTextContent(
      'That colour is already value 3.',
    );
  });
});
