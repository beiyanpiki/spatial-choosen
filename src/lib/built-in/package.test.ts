import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildEmptyPreprocessProject } from '@/app/built-in/projectState';
import type { PreprocessSourceImage, ProjectedSpot } from '@/types/built-in';
import {
	deserializePreprocessImport,
	deserializePreprocessProject,
	deserializePreprocessProjectText,
	PACKAGE_VERSION,
	serializePreprocessProject,
} from '@/lib/built-in/package';

const createProjectedSpot = (id: string, arrayRow: number, arrayCol: number): ProjectedSpot => ({
	id,
	barcode: id,
	arrayRow,
	arrayCol,
	x: arrayCol / 10,
	y: arrayRow / 10,
	width: 0.08,
	height: 0.08,
	diameterX: 0.08,
	diameterY: 0.08,
});

const createHeSourceImage = (): PreprocessSourceImage => ({
	id: 'he-source',
	kind: 'he',
	fileName: 'he.png',
	mimeType: 'image/png',
	sizeBytes: 1,
	width: 2048,
	height: 2048,
	lastModified: 0,
	sourceBlob: new Blob(['he'], { type: 'image/png' }),
	objectUrl: 'blob:he',
	dataUrl: 'data:image/png;base64,aGVsbG8=',
	workingBlob: new Blob(['he-working'], { type: 'image/jpeg' }),
	workingObjectUrl: 'blob:he-working',
	workingDataUrl: 'data:image/jpeg;base64,aGVsbG8=',
	workingWidth: 1024,
	workingHeight: 1024,
});

type PackagedPayload = {
	version: number;
	project: {
		chipConfig: { projectedSpots: unknown };
		sourceAssets: {
			images: { he: Record<string, unknown> | null };
		};
	};
};

const parsePayload = async (blob: Blob): Promise<PackagedPayload> =>
	JSON.parse(await blob.text()) as PackagedPayload;

describe('preprocess package serialization', () => {
	beforeEach(() => {
		vi.stubGlobal('window', {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('exports a numeric PACKAGE_VERSION', () => {
		expect(PACKAGE_VERSION).toBeTypeOf('number');
		expect(PACKAGE_VERSION).toBe(4);
	});

	it('round-trips a project and reproduces id, name, and slices with projectedSpots stripped', async () => {
		const project = buildEmptyPreprocessProject('Package Project');
		// Force projectedSpots so we can assert they never survive the package.
		project.chipConfig.projectedSpots = [
			createProjectedSpot('spot-a', 1, 1),
			createProjectedSpot('spot-b', 2, 2),
		];

		const result = await deserializePreprocessProject(
			await serializePreprocessProject(project),
		);

		expect(result.id).toBe(project.id);
		expect(result.name).toBe(project.name);
		expect(result.currentStep).toBe(project.currentStep);
		expect(result.sourceAssets).toEqual(project.sourceAssets);
		expect(result.tissueSelection).toEqual(project.tissueSelection);
		expect(result.chipConfig.projectedSpots).toBeNull();
		expect(result.chipConfig).toEqual({ ...project.chipConfig, projectedSpots: null });
	});

	it('strips runtime image state and projectedSpots from the serialized package payload', async () => {
		const project = buildEmptyPreprocessProject('Stripped Project');
		project.sourceAssets.images.he = createHeSourceImage();
		project.chipConfig.projectedSpots = [createProjectedSpot('spot-a', 1, 1)];

		const payload = await parsePayload(await serializePreprocessProject(project));

		expect(payload.version).toBe(PACKAGE_VERSION);
		// The package never carries projectedSpots; they recompute after import.
		expect(payload.project.chipConfig.projectedSpots).toBeNull();

		const he = payload.project.sourceAssets.images.he;
		expect(he).not.toBeNull();
		expect(he).not.toHaveProperty('sourceBlob');
		expect(he).not.toHaveProperty('objectUrl');
		expect(he).not.toHaveProperty('dataUrl');
		expect(he).not.toHaveProperty('workingBlob');
		expect(he).not.toHaveProperty('workingObjectUrl');
		expect(he).not.toHaveProperty('workingDataUrl');
		expect(he).toMatchObject({ id: 'he-source', kind: 'he', fileName: 'he.png' });
	});

	it('rejects unsupported package versions via deserializePreprocessProjectText', () => {
		const project = buildEmptyPreprocessProject('Versioned Project');
		expect(() =>
			deserializePreprocessProjectText(JSON.stringify({ version: 99, project })),
		).toThrow(/unsupported package version/i);
	});

	it('tolerates surplus top-level slice keys from older bundles', () => {
		const project = buildEmptyPreprocessProject('Legacy Bundle');
		const result = deserializePreprocessProjectText(
			JSON.stringify({
				version: 1,
				project: {
					...project,
					localization: { legacy: true },
					heFocus: { legacy: true },
					alignment: { legacy: true },
					cropQc: { legacy: true },
					exportState: { legacy: true },
				},
			}),
		);
		const surplus = result as unknown as Record<string, unknown>;
		expect(surplus.id).toBe(project.id);
		expect(surplus.name).toBe(project.name);
		expect(surplus.localization).toBeUndefined();
		expect(surplus.heFocus).toBeUndefined();
		expect(surplus.alignment).toBeUndefined();
		expect(surplus.cropQc).toBeUndefined();
		expect(surplus.exportState).toBeUndefined();
	});

	it('imports a non-zip JSON blob via deserializePreprocessImport', async () => {
		const project = buildEmptyPreprocessProject('Import Project');
		const result = await deserializePreprocessImport(
			await serializePreprocessProject(project),
		);
		expect(result.id).toBe(project.id);
		expect(result.name).toBe(project.name);
	});
});
