import { ChakraProvider } from '@chakra-ui/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  LegacyPreprocessProject,
  LocalizationImageTransform,
  PreprocessProject,
  PreprocessRect,
} from '@/types/preprocess';
import {
  clampNormalizedSquareRect,
  translateChipBounds,
} from '../../../lib/preprocess/localization';

const mockRunHeAutoLocalization = vi.fn();
const alignmentPanelSpy = vi.fn();
const invalidateOnHeFocusChangeSpy = vi.fn((project: unknown) => project);
const invalidateOnHeFocusChipBoundsChangeSpy = vi.fn((project: unknown) => project);
const HEFOCUS_IMAGE_ASPECT_RATIO = 240 / 180;

vi.mock('../../../lib/preprocess/alignment', () => ({
  applyAcceptedAutoAlignment: vi.fn(),
  classifyAutoRefinementOutcome: () => ({ accepted: false, fallbackReason: 'no-proposal' }),
  computeAlignmentStatus: () => 'ready',
  normalizeAlignmentSlice: (value: Record<string, unknown>) => value,
}));

vi.mock('../../../lib/preprocess/cropQc', () => ({
  runCropQc: vi.fn(),
}));

vi.mock('../../../lib/preprocess/exportBundle', () => ({
  exportPreprocessZip: vi.fn(),
  getPreprocessZipExportReadiness: () => ({ canExport: false, reason: 'Not used in this test.' }),
}));

vi.mock('../../../lib/preprocess/heAutoLocalization', () => ({
  runHeAutoLocalization: (...args: unknown[]) => mockRunHeAutoLocalization(...args),
}));

vi.mock('../../../lib/preprocess/invalidation', () => ({
  invalidateOnAlignmentChange: (project: unknown) => project,
  invalidateOnCropQcChange: (project: unknown) => project,
  invalidateOnHeFocusAutoProposalChange: (project: unknown) => project,
  invalidateOnHeFocusChange: (project: unknown) => invalidateOnHeFocusChangeSpy(project),
  invalidateOnHeFocusChipBoundsChange: (project: unknown) => invalidateOnHeFocusChipBoundsChangeSpy(project),
  invalidateOnHeFocusCommit: (project: unknown) => invalidateOnHeFocusChangeSpy(project),
  invalidateOnLocalizationChange: (project: unknown) => project,
  invalidateOnSourceAssetsChange: (project: unknown) => project,
}));

vi.mock('../../../lib/preprocess/loadOpenCv', () => ({
  loadOpenCv: vi.fn(),
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
  CropQcPanel: () => null,
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

  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
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
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

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
	HTMLCanvasElement.prototype.toDataURL = vi.fn(
		() => 'data:image/png;base64,regenerated-he-focus-preview',
	) as unknown as typeof HTMLCanvasElement.prototype.toDataURL;
});

const { theme } = await import('../../../theme');
const { buildEmptyPreprocessProject, normalizeProjectForWorkspace } = await import('../projectState');
const { PreprocessWorkspace, getHeFocusComparisonSource } = await import('./PreprocessWorkspace');

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
    autoProposal: {
      status: 'idle',
      method: null,
      coarseBounds: null,
      refinedBounds: null,
      refinedQuad: null,
      rotationDegrees: null,
      eccCorrelation: null,
      failureReason: null,
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
}: {
  initialProject: PreprocessProject;
  onProjectChange?: (project: PreprocessProject) => void;
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
        onStepChange={vi.fn()}
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

describe('PreprocessWorkspace rotation contract', () => {
  beforeEach(() => {
    mockRunHeAutoLocalization.mockReset();
    alignmentPanelSpy.mockReset();
		invalidateOnHeFocusChangeSpy.mockClear();
		invalidateOnHeFocusChipBoundsChangeSpy.mockClear();
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

	it('keeps Localization overlay fixed while stored image rotation changes', async () => {
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

    const beforePoints = getPolygonPoints('localize-box-outline');
    expect(beforePoints).toBeTruthy();

    await user.click(screen.getByTestId('localize-stage-rotate-right-90'));

    await waitFor(() => {
      expect(screen.getByTestId('localize-stage-rotation-value')).toHaveTextContent('90.0°');
    });

		const afterPoints = getPolygonPoints('localize-box-outline');
		expect(afterPoints).toBe(beforePoints);
		expect(latestProject.localization.imageTransform.rotationDegrees).toBe(90);
		expect(latestProject.localization.chipBounds).toEqual(initialChipBounds);
	});

	it('keeps HEFocus overlay fixed while stored image rotation changes', async () => {
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

    const beforePoints = getPolygonPoints('he-focus-box-outline');
    expect(beforePoints).toBeTruthy();

    await user.click(screen.getByTestId('he-focus-stage-rotate-right-90'));

    await waitFor(() => {
      expect(screen.getByTestId('he-focus-stage-rotation-value')).toHaveTextContent('90.0°');
    });

		const afterPoints = getPolygonPoints('he-focus-box-outline');
		expect(afterPoints).toBe(beforePoints);
		expect(latestProject.heFocus.imageTransform.rotationDegrees).toBe(90);
		const chipBounds = latestProject.heFocus.chipBounds as PreprocessRect;
		expect(chipBounds).toMatchObject({ x: 0.24, y: 0.28, height: 0.4 });
		expect(chipBounds.width).toBeCloseTo(0.3);
	});

	it('renders Localization overlay fixed on first paint when the saved transform starts rotated and flipped', async () => {
		const baselineProject = createBaseProject();
		const baselineRender = render(<WorkspaceHarness initialProject={baselineProject} />);

		await waitFor(() => {
			expect(screen.getByTestId('localize-box-outline')).toBeInTheDocument();
		});

		const baselineLocalizationPoints = parsePoints(getPolygonPoints('localize-box-outline'));
		baselineRender.unmount();

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

		expect(parsePoints(getPolygonPoints('localize-box-outline'))).toEqual(baselineLocalizationPoints);
		expect(screen.getByTestId('localize-stage-rotation-value')).toHaveTextContent('90.0°');
	});

	it('renders HEFocus overlay fixed on first paint when the saved transform starts rotated and flipped', async () => {
		const baselineProject = createBaseProject();
		baselineProject.currentStep = 'heFocus';
		const baselineRender = render(<WorkspaceHarness initialProject={baselineProject} />);

		await waitFor(() => {
			expect(screen.getByTestId('he-focus-box-outline')).toBeInTheDocument();
		});

		const baselineHeFocusPoints = parsePoints(getPolygonPoints('he-focus-box-outline'));
		baselineRender.unmount();

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

		expect(parsePoints(getPolygonPoints('he-focus-box-outline'))).toEqual(baselineHeFocusPoints);
		expect(screen.getByTestId('he-focus-stage-rotation-value')).toHaveTextContent('-90.0°');
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
				'Localize inner-chip reference',
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

		await waitFor(() => {
			expect(latestProject.heFocus.focusedImageDataUrl).toBe(
				'data:image/png;base64,regenerated-he-focus-preview',
			);
			expect(screen.getByTestId('he-focus-localize-reference-preview').getAttribute('src')).toContain(
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

	it('shows preparing and missing-prerequisite Localize reference fallback states in HEFocus', async () => {
		const preparingProject = createBaseProject();
		preparingProject.currentStep = 'heFocus';

		const preparingRender = render(
			<WorkspaceHarness initialProject={preparingProject} />,
		);

		expect(screen.getByTestId('he-focus-localize-reference-card')).toHaveTextContent(
			'Preparing the Localize inner-chip reference preview.',
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
			'Complete Localize with a committed inner-chip box to enable this comparison reference.',
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
