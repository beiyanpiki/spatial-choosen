import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildEmptyPreprocessProject } from '@/app/built-in/projectState';
import type {
	PreprocessProject,
	PreprocessSourceImage,
	ProjectedSpot,
	TissueActivationValue,
} from '@/types/built-in';

import {
	PREPROCESS_SOURCE_IMAGE_STORE,
	PREPROCESS_THUMBNAIL_STORE,
	PREPROCESS_WORKING_IMAGE_STORE,
} from './constants';
import {
	deletePreprocessProject,
	getPreprocessProject,
	readPreprocessProjectSummaries,
	upsertPreprocessProject,
	upsertPreprocessProjectMetadata,
} from './storage';

const createPngBytes = (width: number, height: number) => {
	const bytes = new Uint8Array(24);

	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
	bytes.set([0x49, 0x48, 0x44, 0x52], 12);

	const view = new DataView(bytes.buffer);
	view.setUint32(16, width);
	view.setUint32(20, height);

	return bytes;
};

const createHeSourceImage = (): PreprocessSourceImage => ({
	id: 'he-source',
	kind: 'he',
	fileName: 'he.png',
	mimeType: 'image/png',
	sizeBytes: 1024,
	width: 4096,
	height: 2048,
	lastModified: 0,
	sourceBlob: new Blob([createPngBytes(4096, 2048)], { type: 'image/png' }),
	thumbnailBlob: new Blob([createPngBytes(100, 100)], { type: 'image/png' }),
	workingBlob: new Blob([createPngBytes(2048, 1024)], { type: 'image/png' }),
	workingWidth: 2048,
	workingHeight: 1024,
});

const createProjectedSpot = (
	id: string,
	arrayRow: number,
	arrayCol: number,
): ProjectedSpot => ({
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

const buildProject = (): PreprocessProject => {
	const project = buildEmptyPreprocessProject('Storage Project');
	project.id = 'storage-project';
	project.createdAt = '2026-04-14T00:00:00.000Z';
	project.updatedAt = '2026-04-14T00:00:00.000Z';
	project.currentStep = 'tissueSelection';
	project.sourceAssets = {
		...project.sourceAssets,
		status: 'complete',
		images: {
			he: createHeSourceImage(),
		},
	};
	project.chipConfig = {
		...project.chipConfig,
		status: 'complete',
		chipType: '50um',
		rows: 64,
		columns: 64,
		pitchX: 50,
		pitchY: 50,
		rotationDegrees: 0,
		projectedSpots: [
			createProjectedSpot('spot-a', 1, 1),
			createProjectedSpot('spot-b', 2, 2),
		],
	};
	project.tissueSelection = {
		...project.tissueSelection,
		status: 'complete',
		mode: 'matrix',
		supportState: 'supported',
		matrix: {
			rows: 2,
			columns: 2,
			values: [1, 0, 0, 1] as TissueActivationValue[],
		},
		autoSelectedSpotIds: ['spot-a'],
		selectedSpotIds: ['spot-a'],
	};
	return project;
};

class MemoryStorage {
	private readonly map = new Map<string, string>();

	getItem(key: string) {
		return this.map.get(key) ?? null;
	}

	setItem(key: string, value: string) {
		this.map.set(key, value);
	}

	removeItem(key: string) {
		this.map.delete(key);
	}

	clear() {
		this.map.clear();
	}
}

const createIndexedDbMock = (
	shouldFailPut: (storeName: string) => boolean = () => false,
	onPut: (storeName: string, key: string) => void = () => undefined,
) => {
	const stores = new Map<string, Map<string, string | Blob>>();

	const ensureStore = (name: string) => {
		if (!stores.has(name)) {
			stores.set(name, new Map());
		}

		const store = stores.get(name);
		if (!store) {
			throw new Error(`Missing mock IndexedDB store: ${name}`);
		}

		return store;
	};

	const database = {
		objectStoreNames: {
			contains: (name: string) => stores.has(name),
		},
		createObjectStore: (name: string) => ensureStore(name),
		transaction: (storeName: string) => {
			ensureStore(storeName);
			const tx: {
				oncomplete: (() => void) | null;
				onerror: (() => void) | null;
				onabort: (() => void) | null;
				error: Error | null;
				objectStore: (name: string) => {
					get: (key: string) => {
						onsuccess: (() => void) | null;
						onerror: (() => void) | null;
						result?: string | Blob;
						error: Error | null;
					};
					put: (value: string | Blob, key: string) => void;
					delete: (key: string) => void;
				};
				close: () => void;
			} = {
				oncomplete: null,
				onerror: null,
				onabort: null,
				error: null,
				objectStore: (name: string) => {
					const target = ensureStore(name);

					return {
						get: (key: string) => {
							const request = {
								onsuccess: null as (() => void) | null,
								onerror: null as (() => void) | null,
								result: undefined as string | Blob | undefined,
								error: null,
							};

							queueMicrotask(() => {
								request.result = target.get(key);
								request.onsuccess?.();
								queueMicrotask(() => tx.oncomplete?.());
							});

							return request;
						},
						put: (value: string | Blob, key: string) => {
							if (shouldFailPut(name)) {
								tx.error = new Error(`Forced ${name} write failure`);
								queueMicrotask(() => tx.onerror?.());
								return;
							}
							target.set(key, value);
							onPut(name, key);
							queueMicrotask(() => tx.oncomplete?.());
						},
						delete: (key: string) => {
							target.delete(key);
							queueMicrotask(() => tx.oncomplete?.());
						},
					};
				},
				close: () => undefined,
			};

			return tx;
		},
		close: () => undefined,
	};

	return {
		open: () => {
			const request = {
				result: database,
				error: null,
				onsuccess: null as (() => void) | null,
				onerror: null as (() => void) | null,
				onupgradeneeded: null as (() => void) | null,
			};

			queueMicrotask(() => {
				request.onupgradeneeded?.();
				request.onsuccess?.();
			});

			return request;
		},
	};
};

const IMAGE_STORES = new Set<string>([
	PREPROCESS_SOURCE_IMAGE_STORE,
	PREPROCESS_THUMBNAIL_STORE,
	PREPROCESS_WORKING_IMAGE_STORE,
]);

describe('preprocess storage', () => {
	let localStorage: MemoryStorage;
	let puts: Array<{ store: string; key: string }>;

	beforeEach(() => {
		localStorage = new MemoryStorage();
		puts = [];
		vi.stubGlobal('window', {
			localStorage,
			indexedDB: createIndexedDbMock(
				() => false,
				(store, key) => puts.push({ store, key }),
			),
			__PREPROCESS_TEST_FORCE_QUOTA__: false,
		});
		vi.spyOn(URL, 'createObjectURL').mockImplementation((value: Blob | MediaSource) => {
			const blob = value as Blob;
			return `blob:${blob.type}:${blob.size}`;
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('round-trips a project, restoring the HE image, null projectedSpots, and tissue selection', async () => {
		const project = buildProject();

		await upsertPreprocessProject(project);
		const hydrated = await getPreprocessProject(project.id);

		expect(hydrated).toBeDefined();

		const he = hydrated?.sourceAssets.images.he;
		expect(he).not.toBeNull();
		expect(he?.fileName).toBe('he.png');
		expect(he?.mimeType).toBe('image/png');
		expect(he?.width).toBe(4096);
		expect(he?.height).toBe(2048);
		expect(he?.sourceBlob).toBeInstanceOf(Blob);
		expect(he?.thumbnailBlob).toBeInstanceOf(Blob);
		expect(he?.workingBlob).toBeInstanceOf(Blob);

		expect(hydrated?.chipConfig.projectedSpots).toBeNull();
		expect(hydrated?.chipConfig.chipType).toBe('50um');
		expect(hydrated?.chipConfig.rows).toBe(64);

		expect(hydrated?.tissueSelection.matrix).toEqual(project.tissueSelection.matrix);
		expect(hydrated?.tissueSelection.autoSelectedSpotIds).toEqual(['spot-a']);
		expect(hydrated?.tissueSelection.supportState).toBe('supported');

		const stored = JSON.parse(
			localStorage.getItem('spatial-builtin-projects') ?? '[]',
		) as Array<Record<string, unknown>>;
		const storedChipConfig = stored[0]?.chipConfig as Record<string, unknown>;
		expect(storedChipConfig.projectedSpots).toBeNull();
		expect(Array.isArray(storedChipConfig.projectedSpots)).toBe(false);
	});

	it('returns summaries after upserting a project', async () => {
		const project = buildProject();

		await upsertPreprocessProject(project);
		const summaries = await readPreprocessProjectSummaries();

		expect(summaries).toHaveLength(1);
		expect(summaries[0]?.id).toBe(project.id);
		expect(summaries[0]?.name).toBe('Storage Project');
		expect(summaries[0]?.currentStep).toBe('tissueSelection');
		expect(summaries[0]?.createdAt).toBe(project.createdAt);
	});

	it('deletes a project and leaves no summary behind', async () => {
		const project = buildProject();

		await upsertPreprocessProject(project);
		expect(await getPreprocessProject(project.id)).toBeDefined();

		await deletePreprocessProject(project.id);

		expect(await getPreprocessProject(project.id)).toBeUndefined();
		expect(await readPreprocessProjectSummaries()).toHaveLength(0);
	});

	it('upsertPreprocessProjectMetadata writes metadata without touching image stores', () => {
		const project = buildProject();

		upsertPreprocessProjectMetadata(project);

		const stored = JSON.parse(
			localStorage.getItem('spatial-builtin-projects') ?? '[]',
		) as Array<Record<string, unknown>>;
		expect(stored).toHaveLength(1);
		expect(stored[0]?.id).toBe(project.id);
		expect(puts.filter((entry) => IMAGE_STORES.has(entry.store))).toEqual([]);
	});

	it('writes image-store entries for the full persist mode', async () => {
		const project = buildProject();

		await upsertPreprocessProject(project);

		const imagePuts = puts.filter((entry) => IMAGE_STORES.has(entry.store));
		expect(imagePuts.map((entry) => entry.key).sort()).toEqual(
			[
				`${project.id}:he`,
				`${project.id}:he-thumbnail`,
				`${project.id}:he-working`,
			].sort(),
		);
	});

	it('skips image-store writes for the metadata persist mode', async () => {
		const project = buildProject();

		await upsertPreprocessProject(project, { mode: 'metadata' });

		expect(puts.filter((entry) => IMAGE_STORES.has(entry.store))).toEqual([]);
		const stored = JSON.parse(
			localStorage.getItem('spatial-builtin-projects') ?? '[]',
		) as Array<Record<string, unknown>>;
		expect(stored).toHaveLength(1);
	});

	it('skips image-store writes for the tissue persist mode', async () => {
		const project = buildProject();

		await upsertPreprocessProject(project, { mode: 'tissue' });

		expect(puts.filter((entry) => IMAGE_STORES.has(entry.store))).toEqual([]);
		const stored = JSON.parse(
			localStorage.getItem('spatial-builtin-projects') ?? '[]',
		) as Array<Record<string, unknown>>;
		expect(stored).toHaveLength(1);
	});

	it('throws a synthetic quota failure and leaves storage untouched', async () => {
		const project = buildProject();
		window.__PREPROCESS_TEST_FORCE_QUOTA__ = true;

		await expect(upsertPreprocessProject(project)).rejects.toThrow(
			'Synthetic preprocess quota failure',
		);

		expect(window.__PREPROCESS_TEST_FORCE_QUOTA__).toBe(false);
		expect(localStorage.getItem('spatial-builtin-projects')).toBeNull();
		expect(puts).toEqual([]);
	});
});
