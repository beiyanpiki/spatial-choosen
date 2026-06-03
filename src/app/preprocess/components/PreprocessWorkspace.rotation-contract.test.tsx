import { ChakraProvider } from '@chakra-ui/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  LegacyPreprocessProject,
  PreprocessPoint,
  LocalizationImageTransform,
  PreprocessProject,
  PreprocessRect,
  PreprocessStepId,
} from '@/types/preprocess';
import {
  clampNormalizedSquareRect,
  translateChipBounds,
} from '@/lib/preprocess/localization';
import {
	getOrientedChipBoundsPixelRect,
	projectSourcePointToDisplayRect,
} from '@/lib/preprocess/imageTransforms';

const mockRunCropQc = vi.fn();
const mockLoadOpenCv = vi.fn(async () => ({ cv: {} }));
const alignmentPanelSpy = vi.fn();
const invalidateOnHeFocusChangeSpy = vi.fn((project: unknown) => project);
const invalidateOnHeFocusChipBoundsChangeSpy = vi.fn((project: unknown) => project);
const WORKSPACE_VIEWPORT = { width: 1024, height: 768 };
const HEFOCUS_IMAGE_ASPECT_RATIO = 240 / 180;
const ROTATED_LOCALIZE_IMAGE_ASPECT_RATIO = 4504 / 4096;
const ROTATED_LOCALIZE_WORKING_IMAGE_ASPECT_RATIO = 2048 / 1862;
const ROTATED_LOCALIZE_SOURCE_IMAGE_SIZE = {
	width: 4504,
	height: 4096,
};
const ROTATED_LOCALIZE_WORKING_IMAGE_SIZE = {
	width: 2048,
	height: 1862,
};
const EXPECTED_ROTATED_LOCALIZE_DRAG_BOUNDS: PreprocessRect = {
	x: 0.23919138590494793,
	y: 0.06374999999999995,
	width: 0.34,
	height: 0.37386718750000003,
};
const canvasContextRecords = new Map<HTMLCanvasElement, MockCanvasContextRecord>();
const toDataUrlSpy = vi.fn(function (this: HTMLCanvasElement) {
  return 'data:image/png;base64,regenerated-he-focus-preview';
});
let defaultImageCtor: typeof Image;

type MockCanvasContextRecord = {
  fillStyle: string;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
  clearRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  closePath: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>;
  rotate: ReturnType<typeof vi.fn>;
  scale: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
};

const getOrCreateCanvasContextRecord = (canvas: HTMLCanvasElement) => {
  const existing = canvasContextRecords.get(canvas);
  if (existing) {
    return existing;
  }

  const record: MockCanvasContextRecord = {
    fillStyle: '',
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    closePath: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
  };

  canvasContextRecords.set(canvas, record);
  return record;
};

const getCanvasContextRecord = (canvas: HTMLCanvasElement) => {
  const record = canvasContextRecords.get(canvas);
  if (!record) {
    throw new Error('Expected mock canvas context to exist');
  }

  return record;
};

const getLastFocusedPreviewRender = () => {
  const cropCanvas = toDataUrlSpy.mock.contexts.at(-1);
  if (!(cropCanvas instanceof HTMLCanvasElement)) {
    throw new Error('Expected focused preview canvas to be rendered');
  }

  return {
    cropCanvas,
    cropContext: getCanvasContextRecord(cropCanvas),
	};
};

const getFocusedPreviewRenderByCropSize = (width: number, height: number) => {
	for (const cropCanvas of toDataUrlSpy.mock.contexts) {
		if (!(cropCanvas instanceof HTMLCanvasElement)) continue;
		if (cropCanvas.width !== width || cropCanvas.height !== height) continue;

		return {
			cropCanvas,
			cropContext: getCanvasContextRecord(cropCanvas),
		};
	}

	throw new Error(`Expected focused preview crop ${width}×${height} to be rendered`);
};

vi.mock('../../../lib/preprocess/alignment', () => ({
  computeAlignmentStatus: () => 'ready',
  normalizeAlignmentSlice: (value: Record<string, unknown>) => value,
}));

vi.mock('../../../lib/preprocess/cropQc', () => ({
  runCropQc: (...args: unknown[]) => mockRunCropQc(...args),
}));

vi.mock('../../../lib/preprocess/exportBundle', () => ({
  exportPreprocessZip: vi.fn(),
  getPreprocessZipExportReadiness: () => ({ canExport: false, reason: 'Not used in this test.' }),
}));

vi.mock('../../../lib/preprocess/invalidation', () => ({
  invalidateOnAlignmentChange: (project: unknown) => project,
  invalidateOnCropQcChange: (project: unknown) => project,
  invalidateOnHeFocusChange: (project: unknown) => invalidateOnHeFocusChangeSpy(project),
  invalidateOnHeFocusChipBoundsChange: (project: unknown) => invalidateOnHeFocusChipBoundsChangeSpy(project),
  invalidateOnHeFocusCommit: (project: unknown) => invalidateOnHeFocusChangeSpy(project),
  invalidateOnLocalizationChange: (project: unknown) => project,
  invalidateOnSourceAssetsChange: (project: unknown) => project,
}));

vi.mock('../../../lib/preprocess/loadOpenCv', () => ({
  loadOpenCv: () => mockLoadOpenCv(),
}));

vi.mock('../../../lib/preprocess/sourceImage', () => ({
  buildSourceImage: vi.fn(),
  createThumbnailBlob: vi.fn(async () => new Blob(['thumbnail'], { type: 'image/png' })),
}));

vi.mock('../../../lib/preprocess/spotProjection', () => ({
  projectSpotsForCrop: vi.fn(),
  resolveAuthoritativeSpotDiameterFullres: vi.fn(),
}));

vi.mock('../../../lib/preprocess/tissuePipeline', () => ({
  runTissueAutoSelection: vi.fn(),
}));

vi.mock('../../../lib/preprocess/chipConfigs', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/preprocess/chipConfigs')>('../../../lib/preprocess/chipConfigs');

  return {
    ...actual,
    loadAllChipConfigManifests: vi.fn(async () => []),
    loadChipConfigData: vi.fn(async () => null),
  };
});

vi.mock('./AlignmentPanel', () => ({
  AlignmentPanel: (props: unknown) => {
    alignmentPanelSpy(props);
    return null;
  },
}));

vi.mock('./CropQcPanel', () => ({
  CropQcPanel: (props: { onRunCrop: () => void }) => {
	  capturedCropQcPanelProps = props;
	  return null;
  },
}));

vi.mock('./ExportPanel', () => ({
  ExportPanel: () => null,
}));

vi.mock('./StepSidebar', () => ({
  StepSidebar: () => null,
}));

vi.mock('./TissueSelectionControls', () => ({
  TissueSelectionControls: () => null,
}));

vi.mock('./TissueSelectionPanel', () => ({
  TissueSelectionPanel: () => null,
}));

let capturedCropQcPanelProps: { onRunCrop: () => void } | null = null;
const originalResizeObserver = globalThis.ResizeObserver;
const originalImage = globalThis.Image;
const originalDevicePixelRatio = globalThis.devicePixelRatio;
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
const originalGetBoundingClientRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');

const restorePrototypeDescriptor = <T extends keyof HTMLElement>(
	key: T,
	descriptor: PropertyDescriptor | undefined,
) => {
	if (descriptor) {
		Object.defineProperty(HTMLElement.prototype, key, descriptor);
		return;
	}
	delete (HTMLElement.prototype as Record<T, unknown>)[key];
};

const stubImageDimensions = (width: number, height: number) => {
	class SizedMockImage {
		onload: (() => void) | null = null;
		onerror: (() => void) | null = null;
		width: number;
		height: number;
		naturalWidth: number;
		naturalHeight: number;

		constructor() {
			this.width = width;
			this.height = height;
			this.naturalWidth = width;
			this.naturalHeight = height;
		}

		set src(_value: string) {
			queueMicrotask(() => {
				this.onload?.();
			});
		}
	}

	vi.stubGlobal('Image', SizedMockImage as unknown as typeof Image);
};

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
  }

	vi.stubGlobal('ResizeObserver', ResizeObserverMock);
	vi.stubGlobal('devicePixelRatio', 1);

  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 1024,
  });

  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 768,
  });

  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1024,
      bottom: 768,
      width: 1024,
      height: 768,
      toJSON: () => ({}),
    }),
  });

  HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
    return getOrCreateCanvasContextRecord(this);
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

	class MockImage {
		onload: (() => void) | null = null;
		onerror: (() => void) | null = null;
		width = 240;
		height = 180;
		naturalWidth = 240;
		naturalHeight = 180;

		set src(_value: string) {
			queueMicrotask(() => {
				this.onload?.();
			});
		}
	}

	vi.stubGlobal('Image', MockImage);
	defaultImageCtor = MockImage as unknown as typeof Image;
	HTMLCanvasElement.prototype.toDataURL = toDataUrlSpy as unknown as typeof HTMLCanvasElement.prototype.toDataURL;
});

afterAll(() => {
	vi.stubGlobal('ResizeObserver', originalResizeObserver);
	vi.stubGlobal('Image', originalImage);
	vi.stubGlobal('devicePixelRatio', originalDevicePixelRatio);
	HTMLCanvasElement.prototype.getContext = originalGetContext;
	HTMLCanvasElement.prototype.toDataURL = originalToDataURL;
	restorePrototypeDescriptor('clientWidth', originalClientWidth);
	restorePrototypeDescriptor('clientHeight', originalClientHeight);
	restorePrototypeDescriptor('getBoundingClientRect', originalGetBoundingClientRect);
});

const { theme } = await import('../../../theme');
const { buildEmptyPreprocessProject, normalizeProjectForWorkspace } = await import('../projectState');
const {
  PreprocessWorkspace,
  generateFocusedHeDataUrl,
  getHeFocusComparisonSource,
} = await import('./PreprocessWorkspace');

const createBaseProject = (): PreprocessProject => {
  const project = normalizeProjectForWorkspace(
    buildEmptyPreprocessProject('Rotation workspace') as LegacyPreprocessProject,
  );

  project.currentStep = 'localization';
  project.sourceAssets.images.eosin = {
    id: 'eosin-source',
    kind: 'eosin',
    fileName: 'eosin.png',
    mimeType: 'image/png',
    sizeBytes: 10,
    width: 200,
    height: 150,
    lastModified: 1,
    dataUrl: 'data:image/png;base64,eosin',
  };
  project.sourceAssets.images.he = {
    id: 'he-source',
    kind: 'he',
    fileName: 'he.png',
    mimeType: 'image/png',
    sizeBytes: 10,
    width: 240,
    height: 180,
    lastModified: 2,
    dataUrl: 'data:image/png;base64,he',
  };

  project.localization = {
    ...project.localization,
    status: 'complete',
    isStale: false,
    updatedAt: null,
    error: null,
    targetImage: 'eosin',
    chipType: '15um',
    method: 'manual',
    chipBounds: { x: 0.18, y: 0.22, width: 0.34, height: 0.34 },
    handles: [],
    boxColor: 'green',
    imageTransform: {
      rotationDegrees: 0,
      flipHorizontal: false,
      flipVertical: false,
      scale: 1,
    },
  };

	project.heFocus = {
		...project.heFocus,
		status: 'complete',
    isStale: false,
    updatedAt: null,
    error: null,
    targetImage: 'he',
		chipBounds: { x: 0.24, y: 0.28, width: 0.3, height: 0.4 },
    handles: [],
    imageTransform: {
      rotationDegrees: 0,
      flipHorizontal: false,
      flipVertical: false,
      scale: 1,
    },
    focusedImageDataUrl: null,
  };

  project.alignment = {
    ...project.alignment,
    status: 'complete',
    isStale: false,
    updatedAt: null,
    error: null,
    source: null,
    solveAccepted: false,
    transform: null,
    previewDataUrl: null,
  };

  return project;
};

function WorkspaceHarness({
  initialProject,
  onProjectChange,
  onStepChange,
}: {
  initialProject: PreprocessProject;
  onProjectChange?: (project: PreprocessProject) => void;
  onStepChange?: (step: PreprocessStepId) => void;
}) {
  const [project, setProject] = useState(initialProject);

  useEffect(() => {
    onProjectChange?.(project);
  }, [onProjectChange, project]);

  return (
    <ChakraProvider theme={theme}>
      <PreprocessWorkspace
        autosaveStatus='saved'
        autosaveDetail={null}
        isLoading={false}
        loadError={null}
        onBackToLanding={vi.fn()}
        onProjectMutate={(updater: (current: PreprocessProject) => PreprocessProject) => {
          setProject((current) => updater(current));
        }}
        onProjectNameChange={vi.fn()}
        onStepChange={onStepChange ?? vi.fn()}
        project={project}
      />
    </ChakraProvider>
  );
}

const getPolygonPoints = (testId: string) => {
  const outline = screen.getByTestId(testId);
  return outline.getAttribute('points');
};

const parsePoints = (value: string | null) => {
	if (!value) return [];

	return value
		.trim()
		.split(/\s+/)
		.map((pair) => pair.split(',').map(Number) as [number, number]);
};

const getParsedPoints = (testId: string) => parsePoints(getPolygonPoints(testId));

const getVisualLowerLeftPoint = (points: [number, number][]) => points.reduce((selected, point) => {
	const sameScreenRow = Math.abs(point[1] - selected[1]) <= 1e-6;
	const lowerOnScreen = point[1] > selected[1] + 1e-6;
	const sameRowAndFurtherLeft = sameScreenRow && point[0] < selected[0];
	return lowerOnScreen || sameRowAndFurtherLeft ? point : selected;
});

type WorkspaceDisplayTransform = {
	originX: number;
	originY: number;
	width: number;
	height: number;
};

const getWorkspaceDisplayTransform = (imageAspectRatio: number, scale = 1) => {
	let viewWidth = WORKSPACE_VIEWPORT.width;
	let viewHeight = viewWidth / imageAspectRatio;

	if (viewHeight > WORKSPACE_VIEWPORT.height) {
		viewHeight = WORKSPACE_VIEWPORT.height;
		viewWidth = viewHeight * imageAspectRatio;
	}

	const viewX = (WORKSPACE_VIEWPORT.width - viewWidth) / 2;
	const viewY = (WORKSPACE_VIEWPORT.height - viewHeight) / 2;
	const width = viewWidth * scale;
	const height = viewHeight * scale;

	return {
		originX: viewX + (viewWidth - width) / 2,
		originY: viewY + (viewHeight - height) / 2,
		width,
		height,
	} satisfies WorkspaceDisplayTransform;
};

const sourcePointToWorkspaceScreen = (
	point: PreprocessPoint,
	imageAspectRatio: number,
	imageTransform: LocalizationImageTransform,
) => {
	const displayTransform = getWorkspaceDisplayTransform(imageAspectRatio, imageTransform.scale);
	const projected = projectSourcePointToDisplayRect(point, imageTransform, displayTransform);

	return [projected.x, projected.y] as [number, number];
};

const getRectSourceCorners = (rect: PreprocessRect) => [
	{ x: rect.x, y: rect.y },
	{ x: rect.x + rect.width, y: rect.y },
	{ x: rect.x + rect.width, y: rect.y + rect.height },
	{ x: rect.x, y: rect.y + rect.height },
] as const;

const expectedOutlinePoints = (
	chipBounds: PreprocessRect,
	imageTransform: LocalizationImageTransform,
	sourceImageAspectRatio: number,
	displayImageAspectRatio = sourceImageAspectRatio,
) => getRectSourceCorners(clampNormalizedSquareRect(chipBounds, sourceImageAspectRatio))
	.map((point) => sourcePointToWorkspaceScreen(
		point,
		displayImageAspectRatio,
		imageTransform,
	));

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

const expectRectCloseTo = (actual: PreprocessRect, expected: PreprocessRect) => {
	expect(actual.x).toBeCloseTo(expected.x, 12);
	expect(actual.y).toBeCloseTo(expected.y, 12);
	expect(actual.width).toBeCloseTo(expected.width, 12);
	expect(actual.height).toBeCloseTo(expected.height, 12);
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

const createRotatedLocalizationProject = () => {
	const project = createBaseProject();
	project.currentStep = 'localization';
	const eosinImage = project.sourceAssets.images.eosin;
	const heImage = project.sourceAssets.images.he;
	if (!eosinImage || !heImage) {
		throw new Error('Expected base project images for rotated localization test');
	}
	project.sourceAssets.images.eosin = {
		...eosinImage,
		width: ROTATED_LOCALIZE_SOURCE_IMAGE_SIZE.width,
		height: ROTATED_LOCALIZE_SOURCE_IMAGE_SIZE.height,
		dataUrl: 'data:image/png;base64,rotated-localize-eosin',
		workingDataUrl: 'data:image/png;base64,rotated-localize-eosin-working',
		workingWidth: ROTATED_LOCALIZE_WORKING_IMAGE_SIZE.width,
		workingHeight: ROTATED_LOCALIZE_WORKING_IMAGE_SIZE.height,
	};
	project.sourceAssets.images.he = {
		...heImage,
		width: ROTATED_LOCALIZE_WORKING_IMAGE_SIZE.width,
		height: ROTATED_LOCALIZE_WORKING_IMAGE_SIZE.height,
		dataUrl: 'data:image/png;base64,rotated-localize-he',
	};
	project.localization.imageTransform = {
		...project.localization.imageTransform,
		rotationDegrees: 90,
	};

	return project;
};

describe('PreprocessWorkspace rotation contract', () => {
	beforeEach(() => {
		mockRunCropQc.mockReset();
		mockLoadOpenCv.mockReset();
		alignmentPanelSpy.mockReset();
		invalidateOnHeFocusChangeSpy.mockClear();
		invalidateOnHeFocusChipBoundsChangeSpy.mockClear();
		capturedCropQcPanelProps = null;
		canvasContextRecords.clear();
		toDataUrlSpy.mockClear();
		if (defaultImageCtor) {
			vi.stubGlobal('Image', defaultImageCtor);
		}
		mockLoadOpenCv.mockResolvedValue({ cv: {} });
		mockRunCropQc.mockResolvedValue({
			eosinReferenceGeometry: {
				rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
				width: 30,
				height: 40,
			},
			heQcGeometry: {
				rect: { x: 0.15, y: 0.25, width: 0.2, height: 0.3 },
				width: 20,
				height: 30,
			},
			cropRect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
			cropWidth: 30,
			cropHeight: 40,
			cropAssets: {
				eosin: {
					fullres: { dataUrl: 'data:image/png;base64,eosin-fullres', width: 30, height: 40 },
					hires: { dataUrl: 'data:image/png;base64,eosin-hires', width: 15, height: 20 },
					lowres: { dataUrl: 'data:image/png;base64,eosin-lowres', width: 8, height: 10 },
				},
				he: {
					fullres: { dataUrl: 'data:image/png;base64,he-fullres', width: 30, height: 40 },
					hires: { dataUrl: 'data:image/png;base64,he-hires', width: 15, height: 20 },
					lowres: { dataUrl: 'data:image/png;base64,he-lowres', width: 8, height: 10 },
				},
			},
			tissue_hires_scalef: 0.5,
			tissue_lowres_scalef: 0.25,
			spot_diameter_fullres: null,
			fiducial_diameter_fullres: 90,
			checkerboardPreview: {
				dataUrl: 'data:image/png;base64,checkerboard',
			},
			featureMatchesPreview: {
				dataUrl: 'data:image/png;base64,feature-matches',
			},
			eosinCropDataUrl: 'data:image/png;base64,eosin-fullres',
			heWarpedCropDataUrl: 'data:image/png;base64,he-fullres',
			checkerboardDataUrl: 'data:image/png;base64,checkerboard',
			featureMatchesDataUrl: 'data:image/png;base64,feature-matches',
		});
	});

	it('pads partial left/top HEFocus overruns with exact white fill before deterministic transforms', async () => {
		await generateFocusedHeDataUrl({
			sourceDataUrl: 'data:image/png;base64,he',
			chipBounds: { x: -0.1, y: -0.05, width: 0.3, height: 0.4 },
			imageTransform: {
				rotationDegrees: 90,
				flipHorizontal: true,
				flipVertical: false,
				scale: 1,
			},
		});

		const { cropCanvas, cropContext } = getLastFocusedPreviewRender();

			expect(cropCanvas.width).toBe(72);
			expect(cropCanvas.height).toBe(72);
			expect(cropContext.fillStyle).toBe('#ffffff');
			expect(cropContext.fillRect).toHaveBeenCalledWith(0, 0, 72, 72);
			expect(cropContext.drawImage).toHaveBeenCalledTimes(1);
			const [drawSource, ...drawArgs] = cropContext.drawImage.mock.calls[0] ?? [];
			expect(drawSource).toMatchObject({ width: 180, height: 240 });
			expect(drawArgs).toEqual([0, 0, 63, 48, 9, 24, 63, 48]);
	});

	it('renders fully out-of-bounds HEFocus crops as all-white outputs at the requested size', async () => {
		await generateFocusedHeDataUrl({
			sourceDataUrl: 'data:image/png;base64,he',
			chipBounds: { x: 1.2, y: 1.1, width: 0.3, height: 0.4 },
			imageTransform: {
				rotationDegrees: -90,
				flipHorizontal: false,
				flipVertical: true,
				scale: 1,
			},
		});

		const { cropCanvas, cropContext } = getLastFocusedPreviewRender();

			expect(cropCanvas.width).toBe(72);
			expect(cropCanvas.height).toBe(72);
			expect(cropContext.fillStyle).toBe('#ffffff');
			expect(cropContext.fillRect).toHaveBeenCalledWith(0, 0, 72, 72);
			expect(cropContext.drawImage).not.toHaveBeenCalled();
	});

	it('preserves in-bounds placement for bottom-right corner overruns', async () => {
		await generateFocusedHeDataUrl({
			sourceDataUrl: 'data:image/png;base64,he',
			chipBounds: { x: 0.8, y: 0.75, width: 0.3, height: 0.4 },
			imageTransform: {
				rotationDegrees: 0,
				flipHorizontal: false,
				flipVertical: false,
				scale: 1,
			},
		});

		const { cropCanvas, cropContext } = getLastFocusedPreviewRender();

		expect(cropCanvas.width).toBe(72);
		expect(cropCanvas.height).toBe(72);
		expect(cropContext.fillStyle).toBe('#ffffff');
		expect(cropContext.fillRect).toHaveBeenCalledWith(0, 0, 72, 72);
		expect(cropContext.drawImage).toHaveBeenCalledTimes(1);
		const [drawSource, ...drawArgs] = cropContext.drawImage.mock.calls[0] ?? [];
		expect(drawSource).toMatchObject({ width: 240, height: 180 });
		expect(drawArgs).toEqual([192, 135, 48, 45, 0, 0, 48, 45]);
	});

	it('passes localization orientation into the alignment reference canvas boundary with normalized scale', async () => {
		const alignmentProject = createBaseProject();
		alignmentProject.currentStep = 'alignment';
		alignmentProject.localization.imageTransform = {
			rotationDegrees: 90,
			flipHorizontal: true,
			flipVertical: false,
			scale: 1.25,
		};

		render(<WorkspaceHarness initialProject={alignmentProject} />);

		await waitFor(() => {
			expect(alignmentPanelSpy).toHaveBeenCalled();
		});

		const alignmentProps = alignmentPanelSpy.mock.calls.at(-1)?.[0] as
			| { referenceImageTransform?: LocalizationImageTransform }
			| undefined;
		expect(alignmentProps?.referenceImageTransform).toEqual({
			rotationDegrees: 90,
			flipHorizontal: true,
			flipVertical: false,
			scale: 1,
		});
	});

	it('does not leak localization scale into the alignment reference canvas boundary', async () => {
		const alignmentProject = createBaseProject();
		alignmentProject.currentStep = 'alignment';
		alignmentProject.localization.imageTransform = {
			rotationDegrees: -90,
			flipHorizontal: false,
			flipVertical: true,
			scale: 2.5,
		};

		render(<WorkspaceHarness initialProject={alignmentProject} />);

		await waitFor(() => {
			expect(alignmentPanelSpy).toHaveBeenCalled();
		});

		const alignmentProps = alignmentPanelSpy.mock.calls.at(-1)?.[0] as
			| { referenceImageTransform?: LocalizationImageTransform }
			| undefined;
		expect(alignmentProps?.referenceImageTransform?.scale).toBe(1);
		expect(alignmentProps?.referenceImageTransform).toMatchObject({
			rotationDegrees: -90,
			flipHorizontal: false,
			flipVertical: true,
		});
	});

	it('derives moving-image padding boundary only for committed out-of-bounds HE focus', async () => {
		const outOfBoundsProject = createBaseProject();
		outOfBoundsProject.currentStep = 'alignment';
		outOfBoundsProject.alignment.movingImage = 'he';
		outOfBoundsProject.heFocus.chipBounds = { x: -0.1, y: 0.12, width: 0.4, height: 0.3 };

		render(<WorkspaceHarness initialProject={outOfBoundsProject} />);

		await waitFor(() => {
			expect(alignmentPanelSpy).toHaveBeenCalled();
		});

		const outOfBoundsProps = alignmentPanelSpy.mock.calls.at(-1)?.[0] as
			| { showMovingImagePaddingBoundary?: boolean }
			| undefined;
		expect(outOfBoundsProps?.showMovingImagePaddingBoundary).toBe(true);

		alignmentPanelSpy.mockReset();

		const inBoundsProject = createBaseProject();
		inBoundsProject.currentStep = 'alignment';
		inBoundsProject.alignment.movingImage = 'he';

		render(<WorkspaceHarness initialProject={inBoundsProject} />);

		await waitFor(() => {
			expect(alignmentPanelSpy).toHaveBeenCalled();
		});

		const inBoundsProps = alignmentPanelSpy.mock.calls.at(-1)?.[0] as
			| { showMovingImagePaddingBoundary?: boolean }
			| undefined;
		expect(inBoundsProps?.showMovingImagePaddingBoundary).toBe(false);

		alignmentPanelSpy.mockReset();

		const nonHeProject = createBaseProject();
		nonHeProject.currentStep = 'alignment';
		nonHeProject.alignment.movingImage = 'eosin';

		render(<WorkspaceHarness initialProject={nonHeProject} />);

		await waitFor(() => {
			expect(alignmentPanelSpy).toHaveBeenCalled();
		});

		const nonHeProps = alignmentPanelSpy.mock.calls.at(-1)?.[0] as
			| { showMovingImagePaddingBoundary?: boolean }
			| undefined;
		expect(nonHeProps?.showMovingImagePaddingBoundary).toBe(false);
	});

	it('moves Localization overlay with image rotation while preserving source chip bounds', async () => {
		const user = userEvent.setup();
		let latestProject = createBaseProject();
		let initialChipBounds: PreprocessRect | null = null;

		render(
			<WorkspaceHarness
				initialProject={latestProject}
				onProjectChange={(project) => {
					latestProject = project;
				}}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByTestId('localize-stage-rotation-value')).toHaveTextContent('0.0°');
			initialChipBounds = JSON.parse(JSON.stringify(latestProject.localization.chipBounds)) as PreprocessRect;
		});

			await user.click(screen.getByTestId('localize-stage-rotate-right-90'));

		await waitFor(() => {
			expect(screen.getByTestId('localize-stage-rotation-value')).toHaveTextContent('90.0°');
		});

			const afterPoints = parsePoints(getPolygonPoints('localize-box-outline'));
			expectPointPairsCloseTo(
				afterPoints,
				expectedOutlinePoints(
						initialChipBounds,
					latestProject.localization.imageTransform,
					200 / 150,
				),
			);
		expect(latestProject.localization.imageTransform.rotationDegrees).toBe(90);
		expect(latestProject.localization.chipBounds).toEqual(initialChipBounds);
	});

	it('moves HEFocus overlay with image rotation while preserving source chip bounds', async () => {
		const user = userEvent.setup();
		let latestProject = createBaseProject();
		latestProject.currentStep = 'heFocus';

		render(
			<WorkspaceHarness
				initialProject={latestProject}
				onProjectChange={(project) => {
					latestProject = project;
				}}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByTestId('he-focus-stage-rotation-value')).toHaveTextContent('0.0°');
			const chipBounds = latestProject.heFocus.chipBounds as {
				height: number;
				width: number;
				x: number;
				y: number;
			};
			expect(chipBounds.height).toBeCloseTo(0.4);
		});

			await user.click(screen.getByTestId('he-focus-stage-rotate-right-90'));

		await waitFor(() => {
			expect(screen.getByTestId('he-focus-stage-rotation-value')).toHaveTextContent('90.0°');
		});

			const afterPoints = parsePoints(getPolygonPoints('he-focus-box-outline'));
			expect(latestProject.heFocus.imageTransform.rotationDegrees).toBe(90);
			const chipBounds = latestProject.heFocus.chipBounds as PreprocessRect;
			expectPointPairsCloseTo(
				afterPoints,
				expectedOutlinePoints(
					chipBounds,
					latestProject.heFocus.imageTransform,
					HEFOCUS_IMAGE_ASPECT_RATIO,
				),
			);
		expect(chipBounds).toMatchObject({ x: 0.24, y: 0.28, height: 0.4 });
		expect(chipBounds.width).toBeCloseTo(0.3);
	});

	it('renders transformed Localization overlay on first paint when the saved transform starts rotated and flipped', async () => {
		const localizationProject = createBaseProject();
		localizationProject.localization.imageTransform = {
			...localizationProject.localization.imageTransform,
			rotationDegrees: 90,
			flipHorizontal: true,
		};

		render(
			<WorkspaceHarness
				initialProject={localizationProject}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByTestId('localize-box-outline')).toBeInTheDocument();
		});

		expectPointPairsCloseTo(
			parsePoints(getPolygonPoints('localize-box-outline')),
				expectedOutlinePoints(
					localizationProject.localization.chipBounds as PreprocessRect,
					localizationProject.localization.imageTransform,
					200 / 150,
				),
		);
		expect(screen.getByTestId('localize-stage-rotation-value')).toHaveTextContent('90.0°');
	});

	it('renders transformed HEFocus overlay on first paint when the saved transform starts rotated and flipped', async () => {
		const heFocusProject = createBaseProject();
		heFocusProject.currentStep = 'heFocus';
		heFocusProject.heFocus.imageTransform = {
			...heFocusProject.heFocus.imageTransform,
			rotationDegrees: -90,
			flipVertical: true,
		};

		render(
			<WorkspaceHarness
				initialProject={heFocusProject}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByTestId('he-focus-box-outline')).toBeInTheDocument();
		});

		expectPointPairsCloseTo(
			parsePoints(getPolygonPoints('he-focus-box-outline')),
				expectedOutlinePoints(
					heFocusProject.heFocus.chipBounds as PreprocessRect,
					heFocusProject.heFocus.imageTransform,
					HEFOCUS_IMAGE_ASPECT_RATIO,
				),
		);
		expect(screen.getByTestId('he-focus-stage-rotation-value')).toHaveTextContent('-90.0°');
	});

	it('keeps HEFocus LL marker at the visual lower-left after drag and flip', async () => {
		let latestProject = createBaseProject();
		latestProject.currentStep = 'heFocus';
		latestProject.heFocus.imageTransform = {
			...latestProject.heFocus.imageTransform,
			rotationDegrees: -180,
		};

		render(
			<WorkspaceHarness
				initialProject={latestProject}
				onProjectChange={(project) => {
					latestProject = project;
				}}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByTestId('he-focus-box-outline')).toBeInTheDocument();
		});

		const body = screen.getByTestId('he-focus-box-body');
		await act(async () => {
			dispatchPointerEvent(body, 'pointerdown', {
				buttons: 1,
				clientX: 360,
				clientY: 380,
				pointerId: 1,
			});
		});

		await act(async () => {
			dispatchPointerEvent(window, 'pointermove', {
				buttons: 1,
				clientX: 440,
				clientY: 420,
				pointerId: 1,
			});
			dispatchPointerEvent(window, 'pointerup', {
				clientX: 440,
				clientY: 420,
				pointerId: 1,
			});
		});

		await waitFor(() => {
			expect(latestProject.heFocus.chipBounds).not.toMatchObject({ x: 0.24, y: 0.28 });
		});

		await userEvent.click(screen.getByTestId('he-focus-stage-flip-horizontal'));

		await waitFor(() => {
			expect(latestProject.heFocus.imageTransform.flipHorizontal).toBe(true);
		});

		const outlinePoints = getParsedPoints('he-focus-box-outline');
		const markerPoints = getParsedPoints('he-focus-box-lower-left-marker');
		expectPointCloseTo(markerPoints[1], getVisualLowerLeftPoint(outlinePoints));
	});

	it('regenerates the Localize reference crop from the rotated committed source-space chip bounds', async () => {
		stubImageDimensions(
			ROTATED_LOCALIZE_SOURCE_IMAGE_SIZE.width,
			ROTATED_LOCALIZE_SOURCE_IMAGE_SIZE.height,
		);

		try {
			let latestProject = createRotatedLocalizationProject();
			latestProject.heFocus.focusedImageDataUrl = 'blob:focused-preview';
			const initialChipBounds = latestProject.localization.chipBounds;
			if (!initialChipBounds) {
				throw new Error('Missing Localize chip bounds for rotated reference crop test');
			}

			const localizationRender = render(
				<WorkspaceHarness
					initialProject={latestProject}
					onProjectChange={(project) => {
						latestProject = project;
					}}
				/>,
			);

			await waitFor(() => {
				expect(screen.getByTestId('localize-stage-rotation-value')).toHaveTextContent('90.0°');
			});
			const localizeOutlinePoints = parsePoints(getPolygonPoints('localize-box-outline'));
				expectPointPairsCloseTo(
					localizeOutlinePoints,
					expectedOutlinePoints(
						initialChipBounds,
						latestProject.localization.imageTransform,
						ROTATED_LOCALIZE_IMAGE_ASPECT_RATIO,
						ROTATED_LOCALIZE_WORKING_IMAGE_ASPECT_RATIO,
					),
			);

			const expectedCommittedBounds = EXPECTED_ROTATED_LOCALIZE_DRAG_BOUNDS;
			const body = screen.getByTestId('localize-box-body');

			await act(async () => {
				dispatchPointerEvent(body, 'pointerdown', {
					buttons: 1,
					clientX: 400,
					clientY: 340,
					pointerId: 1,
				});
			});

			await act(async () => {
				dispatchPointerEvent(window, 'pointermove', {
					buttons: 1,
					clientX: 520,
					clientY: 390,
					pointerId: 1,
				});
				dispatchPointerEvent(window, 'pointerup', {
					clientX: 520,
					clientY: 390,
					pointerId: 1,
				});
			});

			await waitFor(() => {
				expect(latestProject.localization.chipBounds).not.toEqual(initialChipBounds);
			});
			expectRectCloseTo(
				latestProject.localization.chipBounds as PreprocessRect,
				expectedCommittedBounds,
			);

			localizationRender.unmount();

			const heFocusProject = {
				...latestProject,
				currentStep: 'heFocus' as const,
				heFocus: {
					...latestProject.heFocus,
					focusedImageDataUrl: 'blob:focused-preview',
				},
			};

			render(<WorkspaceHarness initialProject={heFocusProject} />);

			await waitFor(() => {
				expect(screen.getByTestId('he-focus-localize-reference-preview')).toBeInTheDocument();
			});

				const requestedBounds = getOrientedChipBoundsPixelRect(
					expectedCommittedBounds,
					latestProject.localization.imageTransform,
					ROTATED_LOCALIZE_SOURCE_IMAGE_SIZE,
					{
						width: ROTATED_LOCALIZE_SOURCE_IMAGE_SIZE.height,
						height: ROTATED_LOCALIZE_SOURCE_IMAGE_SIZE.width,
					},
				);
				const { cropCanvas, cropContext } = getFocusedPreviewRenderByCropSize(
					requestedBounds.width,
					requestedBounds.height,
				);

				expect(cropCanvas.width).toBe(requestedBounds.width);
				expect(cropCanvas.height).toBe(requestedBounds.height);
				expect(cropContext.drawImage).toHaveBeenCalledWith(
					expect.objectContaining({ width: 4096, height: 4504 }),
					requestedBounds.x,
					requestedBounds.y,
					requestedBounds.width,
					requestedBounds.height,
					0,
					0,
					requestedBounds.width,
					requestedBounds.height,
				);
		} finally {
			vi.stubGlobal('Image', defaultImageCtor);
		}
	});

	it('sends the rotated committed source-space chip bounds into Crop/QC', async () => {
		stubImageDimensions(
			ROTATED_LOCALIZE_SOURCE_IMAGE_SIZE.width,
			ROTATED_LOCALIZE_SOURCE_IMAGE_SIZE.height,
		);

		try {
			let latestProject = createRotatedLocalizationProject();
			latestProject.heFocus.focusedImageDataUrl = 'blob:focused-preview';
			const initialChipBounds = latestProject.localization.chipBounds;
			if (!initialChipBounds) {
				throw new Error('Missing Localize chip bounds for rotated Crop/QC test');
			}

			const localizationRender = render(
				<WorkspaceHarness
					initialProject={latestProject}
					onProjectChange={(project) => {
						latestProject = project;
					}}
				/>,
			);

			await waitFor(() => {
				expect(screen.getByTestId('localize-stage-rotation-value')).toHaveTextContent('90.0°');
			});

			const expectedCommittedBounds = EXPECTED_ROTATED_LOCALIZE_DRAG_BOUNDS;
			const body = screen.getByTestId('localize-box-body');

			await act(async () => {
				dispatchPointerEvent(body, 'pointerdown', {
					buttons: 1,
					clientX: 400,
					clientY: 340,
					pointerId: 1,
				});
			});

			await act(async () => {
				dispatchPointerEvent(window, 'pointermove', {
					buttons: 1,
					clientX: 520,
					clientY: 390,
					pointerId: 1,
				});
				dispatchPointerEvent(window, 'pointerup', {
					clientX: 520,
					clientY: 390,
					pointerId: 1,
				});
			});

			await waitFor(() => {
				expect(latestProject.localization.chipBounds).not.toEqual(initialChipBounds);
			});
			expectRectCloseTo(
				latestProject.localization.chipBounds as PreprocessRect,
				expectedCommittedBounds,
			);

			localizationRender.unmount();

			const cropQcProject = {
				...latestProject,
				currentStep: 'cropQc' as const,
				alignment: {
						...latestProject.alignment,
						movingImage: 'eosin' as const,
						affineMatrix: [1, 0, 0, 0, 1, 0] as const,
					},
			};

			render(<WorkspaceHarness initialProject={cropQcProject} />);

			await waitFor(() => {
				expect(capturedCropQcPanelProps).not.toBeNull();
			});

			await act(async () => {
				capturedCropQcPanelProps?.onRunCrop();
			});

			await waitFor(() => {
				expect(mockLoadOpenCv).toHaveBeenCalledTimes(1);
				expect(mockRunCropQc).toHaveBeenCalledTimes(1);
			});

			const [request] = mockRunCropQc.mock.calls[0] ?? [];
			if (!request || typeof request !== 'object') {
				throw new Error('Expected Crop/QC request payload to be captured');
			}

			expect(request).toMatchObject({
				chipBounds: expectedCommittedBounds,
				imageTransform: { rotationDegrees: 90 },
				acceptedChipBounds: latestProject.heFocus.chipBounds,
			});
		} finally {
			vi.stubGlobal('Image', defaultImageCtor);
		}
	});

	it('keeps he focus preview stable during drag moves and invalidates once on final release', async () => {
		let latestProject = createBaseProject();
		latestProject.currentStep = 'heFocus';
		latestProject.heFocus.focusedImageDataUrl = 'blob:focused-preview';

		render(
			<WorkspaceHarness
				initialProject={latestProject}
				onProjectChange={(project) => {
					latestProject = project;
				}}
			/>,
		);

		await waitFor(() => {
			const preview = screen.getByTestId('he-focus-localize-reference-preview');
			expect(preview).toBeInTheDocument();
			expect(screen.getByTestId('he-focus-localize-reference-card')).toHaveTextContent(
				'Eosin chip-localized reference',
			);
			expect(preview.getAttribute('src')).toContain(
				'data:image/png;base64,regenerated-he-focus-preview',
			);
		});

		const baseProject = createBaseProject();
		if (!baseProject.heFocus.chipBounds) {
			throw new Error('Missing HEFocus chip bounds for drag test');
		}

		const initialHeFocusRect = clampNormalizedSquareRect(
			baseProject.heFocus.chipBounds,
			HEFOCUS_IMAGE_ASPECT_RATIO,
		);
		const expectedFinalMove = translateChipBounds(
			initialHeFocusRect,
			{ x: 120 / 1024, y: 50 / 768 },
			HEFOCUS_IMAGE_ASPECT_RATIO,
		);

		const body = screen.getByTestId('he-focus-box-body');

		await act(async () => {
			dispatchPointerEvent(body, 'pointerdown', {
				buttons: 1,
				clientX: 400,
				clientY: 340,
				pointerId: 1,
			});
		});

		await act(async () => {
			dispatchPointerEvent(window, 'pointermove', {
				buttons: 1,
				clientX: 440,
				clientY: 360,
				pointerId: 1,
			});
			dispatchPointerEvent(window, 'pointermove', {
				buttons: 1,
				clientX: 520,
				clientY: 390,
				pointerId: 1,
			});
		});

		expect(latestProject.heFocus.chipBounds).toEqual(createBaseProject().heFocus.chipBounds);
		expect(invalidateOnHeFocusChangeSpy).not.toHaveBeenCalled();
		expect(latestProject.heFocus.focusedImageDataUrl).toBe('blob:focused-preview');
		expect(screen.getByTestId('he-focus-localize-reference-preview').getAttribute('src')).toContain(
			'data:image/png;base64,regenerated-he-focus-preview',
		);

		await act(async () => {
			dispatchPointerEvent(window, 'pointerup', {
				clientX: 520,
				clientY: 390,
				pointerId: 1,
			});
		});

		await waitFor(() => {
			expect(invalidateOnHeFocusChangeSpy).toHaveBeenCalledTimes(1);
		});

		await waitFor(() => {
			expect(latestProject.heFocus.chipBounds).toEqual(expectedFinalMove);
		});

		expect(latestProject.heFocus.focusedImageDataUrl).toBeNull();
		expect(screen.getByTestId('he-focus-localize-reference-preview').getAttribute('src')).toContain(
			'data:image/png;base64,regenerated-he-focus-preview',
		);
	});

	it('commits true out-of-bounds HEFocus bounds when the stage emits permissive geometry', async () => {
		let latestProject = createBaseProject();
		latestProject.currentStep = 'heFocus';
		latestProject.heFocus.focusedImageDataUrl = 'blob:focused-preview';

		render(
			<WorkspaceHarness
				initialProject={latestProject}
				onProjectChange={(project) => {
					latestProject = project;
				}}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByTestId('he-focus-box-outline')).toBeInTheDocument();
		});

		const initialOutline = getPolygonPoints('he-focus-box-outline');
		const initialBounds = createBaseProject().heFocus.chipBounds;
		if (!initialBounds) {
			throw new Error('Missing HEFocus chip bounds for out-of-bounds commit test');
		}
		const normalizedInitialBounds = clampNormalizedSquareRect(
			initialBounds,
			HEFOCUS_IMAGE_ASPECT_RATIO,
		);
		const expectedCommittedBounds = translateChipBounds(
			normalizedInitialBounds,
			{ x: -400 / 1024, y: -320 / 768 },
			HEFOCUS_IMAGE_ASPECT_RATIO,
			{ clampToImage: false },
		);
		const body = screen.getByTestId('he-focus-box-body');

		await act(async () => {
			dispatchPointerEvent(body, 'pointerdown', {
				buttons: 1,
				clientX: 400,
				clientY: 340,
				pointerId: 1,
			});
		});

		await act(async () => {
			dispatchPointerEvent(window, 'pointermove', {
				buttons: 1,
				clientX: 0,
				clientY: 20,
				pointerId: 1,
			});
		});

		const draftOutline = getPolygonPoints('he-focus-box-outline');
		expect(draftOutline).not.toBe(initialOutline);
		expect(latestProject.heFocus.chipBounds).toEqual(initialBounds);
		expect(invalidateOnHeFocusChangeSpy).not.toHaveBeenCalled();
		expect(screen.getByTestId('he-focus-localize-reference-preview').getAttribute('src')).toContain(
			'data:image/png;base64,regenerated-he-focus-preview',
		);

		await act(async () => {
			dispatchPointerEvent(window, 'pointerup', {
				clientX: 0,
				clientY: 20,
				pointerId: 1,
			});
		});

		await waitFor(() => {
			expect(invalidateOnHeFocusChangeSpy).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(latestProject.heFocus.chipBounds).not.toBeNull();
		});
		const committedBounds = latestProject.heFocus.chipBounds;
		if (!committedBounds) {
			throw new Error('Expected HEFocus chip bounds to commit on pointerup');
		}
		expect(committedBounds.x).toBeCloseTo(expectedCommittedBounds.x);
		expect(committedBounds.y).toBeCloseTo(expectedCommittedBounds.y);
		expect(committedBounds.width).toBeCloseTo(expectedCommittedBounds.width);
		expect(committedBounds.height).toBeCloseTo(expectedCommittedBounds.height);
		expect(latestProject.heFocus.handles).toEqual([
			{ id: 'nw', label: 'NW', point: { x: committedBounds.x, y: committedBounds.y } },
			{ id: 'ne', label: 'NE', point: { x: committedBounds.x + committedBounds.width, y: committedBounds.y } },
			{ id: 'se', label: 'SE', point: { x: committedBounds.x + committedBounds.width, y: committedBounds.y + committedBounds.height } },
			{ id: 'sw', label: 'SW', point: { x: committedBounds.x, y: committedBounds.y + committedBounds.height } },
		]);
		expect(latestProject.heFocus.handles[0]?.point.x).toBeLessThan(0);
		expect(latestProject.heFocus.handles[0]?.point.y).toBeLessThan(0);
		expect(committedBounds.x).toBeLessThan(0);
		expect(committedBounds.y).toBeLessThan(0);
		expect(latestProject.heFocus.focusedImageDataUrl).toBeNull();
	});

	it('generates the focused H&E image only after entering Align', async () => {
		let latestProject = createBaseProject();
		latestProject.currentStep = 'heFocus';
		latestProject.heFocus.focusedImageDataUrl = null;

		const heFocusRender = render(
			<WorkspaceHarness
				initialProject={latestProject}
				onProjectChange={(project) => {
					latestProject = project;
				}}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByTestId('he-focus-box-outline')).toBeInTheDocument();
		});
		await act(async () => {
			await Promise.resolve();
		});

		expect(latestProject.heFocus.focusedImageDataUrl).toBeNull();

		heFocusRender.unmount();

		const alignmentProject = {
			...latestProject,
			currentStep: 'alignment' as const,
		};

		render(
			<WorkspaceHarness
				initialProject={alignmentProject}
				onProjectChange={(project) => {
					latestProject = project;
				}}
			/>,
		);

		await waitFor(() => {
			expect(latestProject.heFocus.focusedImageDataUrl).toBe(
				'data:image/png;base64,regenerated-he-focus-preview',
			);
		});
	});

	it('clears HEFocus draft geometry on pointercancel without committing or invalidating', async () => {
		let latestProject = createBaseProject();
		latestProject.currentStep = 'heFocus';

		render(
			<WorkspaceHarness
				initialProject={latestProject}
				onProjectChange={(project) => {
					latestProject = project;
				}}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByTestId('he-focus-box-outline')).toBeInTheDocument();
		});

		const initialOutline = getPolygonPoints('he-focus-box-outline');
		const initialBounds = createBaseProject().heFocus.chipBounds;
		const body = screen.getByTestId('he-focus-box-body');

		await act(async () => {
			dispatchPointerEvent(body, 'pointerdown', {
				buttons: 1,
				clientX: 400,
				clientY: 340,
				pointerId: 1,
			});
		});

		await act(async () => {
			dispatchPointerEvent(window, 'pointermove', {
				buttons: 1,
				clientX: 520,
				clientY: 390,
				pointerId: 1,
			});
		});

		const draftOutline = getPolygonPoints('he-focus-box-outline');
		expect(draftOutline).not.toBe(initialOutline);
		expect(latestProject.heFocus.chipBounds).toEqual(initialBounds);
		expect(invalidateOnHeFocusChangeSpy).not.toHaveBeenCalled();

		await act(async () => {
			dispatchPointerEvent(window, 'pointercancel', {
				clientX: 520,
				clientY: 390,
				pointerId: 1,
			});
		});

		await waitFor(() => {
			expect(getPolygonPoints('he-focus-box-outline')).toBe(initialOutline);
		});
		expect(latestProject.heFocus.chipBounds).toEqual(initialBounds);
		expect(invalidateOnHeFocusChangeSpy).not.toHaveBeenCalled();
	});

	it('shows preparing and missing-prerequisite eosin reference fallback states in HEFocus', async () => {
		const preparingProject = createBaseProject();
		preparingProject.currentStep = 'heFocus';

		const preparingRender = render(
			<WorkspaceHarness initialProject={preparingProject} />,
		);

		expect(screen.getByTestId('he-focus-localize-reference-card')).toHaveTextContent(
			'Preparing the eosin chip-localized reference preview.',
		);

		await waitFor(() => {
			expect(screen.getByTestId('he-focus-localize-reference-preview')).toBeInTheDocument();
		});

		preparingRender.unmount();

		const missingLocalizationProject = createBaseProject();
		missingLocalizationProject.currentStep = 'heFocus';
		missingLocalizationProject.localization.chipBounds = null;

		render(<WorkspaceHarness initialProject={missingLocalizationProject} />);

		expect(screen.getByTestId('he-focus-localize-reference-card')).toHaveTextContent(
			'Complete chip localization with a committed capture area to enable this comparison reference.',
		);
		expect(screen.queryByTestId('he-focus-localize-reference-preview')).not.toBeInTheDocument();
	});

	it('derives the he focus comparison source from committed localization data only', () => {
		const baseProject = createBaseProject();
		baseProject.currentStep = 'heFocus';
		baseProject.heFocus.focusedImageDataUrl = 'blob:focused-preview';

		const baseSource = getHeFocusComparisonSource(baseProject);
		expect(baseSource).toEqual({
			sourceDataUrl: 'data:image/png;base64,eosin',
			chipBounds: baseProject.localization.chipBounds,
			imageTransform: baseProject.localization.imageTransform,
		});

		const dragOnlyProject = {
			...baseProject,
			heFocus: {
				...baseProject.heFocus,
				chipBounds: { x: 0.29, y: 0.31, width: 0.28, height: 0.28 },
				focusedImageDataUrl: 'blob:changed-during-drag',
			},
		};

		expect(getHeFocusComparisonSource(dragOnlyProject)).toEqual(baseSource);

		const localizationChangedProject = {
			...baseProject,
			localization: {
				...baseProject.localization,
				chipBounds: { x: 0.14, y: 0.16, width: 0.38, height: 0.38 },
			},
		};

		expect(getHeFocusComparisonSource(localizationChangedProject)).not.toEqual(baseSource);
	});
});
