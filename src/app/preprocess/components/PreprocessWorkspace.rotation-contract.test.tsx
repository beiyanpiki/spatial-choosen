import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  LegacyPreprocessProject,
  LocalizationImageTransform,
  PreprocessProject,
  PreprocessRect,
} from '@/types/preprocess';

const mockRunHeAutoLocalization = vi.fn();
const alignmentPanelSpy = vi.fn();

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
  invalidateOnHeFocusChange: (project: unknown) => project,
  invalidateOnHeFocusChipBoundsChange: (project: unknown) => project,
  invalidateOnLocalizationChange: (project: unknown) => project,
  invalidateOnSourceAssetsChange: (project: unknown) => project,
}));

vi.mock('../../../lib/preprocess/loadOpenCv', () => ({
  loadOpenCv: vi.fn(),
}));

vi.mock('../../../lib/preprocess/sourceImage', () => ({
  buildSourceImage: vi.fn(),
  createThumbnailBlob: vi.fn(),
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
});

const { theme } = await import('../../../theme');
const { buildEmptyPreprocessProject, normalizeProjectForWorkspace } = await import('../projectState');
const { PreprocessWorkspace } = await import('./PreprocessWorkspace');

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

describe('PreprocessWorkspace rotation contract', () => {
  beforeEach(() => {
    mockRunHeAutoLocalization.mockReset();
    alignmentPanelSpy.mockReset();
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
});
