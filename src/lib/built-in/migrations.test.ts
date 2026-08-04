import { describe, expect, it } from 'vitest';

import { buildEmptyPreprocessProject } from '@/app/built-in/projectState';
import type {
	LegacyPreprocessProject,
	PreprocessProject,
	TissueActivationMatrix,
} from '@/types/built-in';

import { PREPROCESS_STORAGE_SCHEMA_VERSION } from './constants';
import { migratePreprocessProject } from './migrations';

// Mirrors CURRENT_WORKFLOW_VERSION inside migrations.ts. The migrator floors
// workflowVersion at this value, so aligning the canonical input lets a full
// round-trip be deeply equal.
const CURRENT_WORKFLOW_VERSION = 3;

const buildCanonicalProject = (): PreprocessProject => {
	const project = buildEmptyPreprocessProject('Canonical Project');
	project.workflowVersion = CURRENT_WORKFLOW_VERSION;
	return project;
};

const buildMatrix = (): TissueActivationMatrix => ({
	rows: 2,
	columns: 2,
	values: [1, 0, 0, 1],
});

describe('migratePreprocessProject', () => {
	it('round-trips an already-canonical project with slices intact', () => {
		const project = buildCanonicalProject();

		const migrated = migratePreprocessProject(project);

		expect(migrated.storageVersion).toBe(PREPROCESS_STORAGE_SCHEMA_VERSION);
		expect(migrated.workflowVersion).toBe(CURRENT_WORKFLOW_VERSION);
		expect(migrated).toEqual(project);
		expect(migrated.sourceAssets).toEqual(project.sourceAssets);
		expect(migrated.chipConfig).toEqual(project.chipConfig);
		expect(migrated.tissueSelection).toEqual(project.tissueSelection);
	});

	it('bumps older workflow/storage versions up to the current schema', () => {
		const project = buildCanonicalProject();
		project.workflowVersion = 1;
		project.storageVersion = 3;

		const migrated = migratePreprocessProject(project);

		expect(migrated.workflowVersion).toBe(CURRENT_WORKFLOW_VERSION);
		expect(migrated.storageVersion).toBe(PREPROCESS_STORAGE_SCHEMA_VERSION);
	});

	it('migrates a minimal legacy-ish input without throwing', () => {
		const minimal = {
			id: 'minimal',
			name: 'Minimal',
			createdAt: '2026-08-04T00:00:00.000Z',
			updatedAt: '2026-08-04T00:00:00.000Z',
			currentStep: 'tissueSelection',
		} as unknown as LegacyPreprocessProject;

		const migrated = migratePreprocessProject(minimal);

		expect(migrated.id).toBe('minimal');
		expect(migrated.currentStep).toBe('tissueSelection');
		expect(migrated.sourceAssets.activeImage).toBe('he');
		expect(migrated.sourceAssets.images.he).toBeNull();
		expect(migrated.chipConfig.projectedSpots).toBeNull();
		expect(migrated.tissueSelection.mode).toBe('matrix');
		expect(migrated.tissueSelection.matrix).toBeNull();
	});

	it('remaps removed/unknown currentStep values back to sourceAssets', () => {
		const base = buildCanonicalProject();

		const removedSteps = [
			'localization',
			'heFocus',
			'alignment',
			'cropQc',
			'exportState',
		] as const;

		for (const step of removedSteps) {
			const input = { ...base, currentStep: step } as unknown as PreprocessProject;
			expect(migratePreprocessProject(input).currentStep).toBe('sourceAssets');
		}

		const unknown = { ...base, currentStep: 'nope' } as unknown as PreprocessProject;
		expect(migratePreprocessProject(unknown).currentStep).toBe('sourceAssets');
	});

	it('preserves valid currentStep values', () => {
		const tissueInput: PreprocessProject = { ...buildCanonicalProject() };
		tissueInput.currentStep = 'tissueSelection';
		expect(migratePreprocessProject(tissueInput).currentStep).toBe('tissueSelection');

		const sourceInput: PreprocessProject = { ...buildCanonicalProject() };
		sourceInput.currentStep = 'sourceAssets';
		expect(migratePreprocessProject(sourceInput).currentStep).toBe('sourceAssets');
	});

	it('normalizes chipConfig.projectedSpots to null even when populated', () => {
		const project = buildCanonicalProject();
		project.chipConfig = {
			...project.chipConfig,
			status: 'complete',
			chipType: '15um',
			rows: 96,
			columns: 96,
			pitchX: 15,
			pitchY: 15,
			rotationDegrees: 12.5,
			projectedSpots: [
				{
					id: 'spot-a',
					barcode: 'spot-a',
					arrayRow: 0,
					arrayCol: 0,
					x: 0,
					y: 0,
					diameterX: 0.08,
					diameterY: 0.08,
				},
			],
		};

		const migrated = migratePreprocessProject(project);

		// projectedSpots are recomputed in the UI after load; never persisted.
		expect(migrated.chipConfig.projectedSpots).toBeNull();
		// Surrounding chipConfig fields survive normalization.
		expect(migrated.chipConfig.status).toBe('complete');
		expect(migrated.chipConfig.chipType).toBe('15um');
		expect(migrated.chipConfig.rows).toBe(96);
		expect(migrated.chipConfig.columns).toBe(96);
		expect(migrated.chipConfig.rotationDegrees).toBe(12.5);
	});

	it('drops eosin images and forces he-only sourceAssets', () => {
		const project = buildCanonicalProject();
		const legacySourceAssets = {
			status: 'complete',
			isStale: false,
			updatedAt: null,
			error: null,
			activeImage: 'eosin',
			images: {
				he: null,
				eosin: {
					id: 'eosin-src',
					kind: 'eosin',
					fileName: 'eosin.png',
					mimeType: 'image/png',
					sizeBytes: 1,
					width: 2048,
					height: 2048,
					lastModified: 0,
				},
			},
			oversizedImageWarning: null,
		} as unknown as PreprocessProject['sourceAssets'];
		project.sourceAssets = legacySourceAssets;

		const migrated = migratePreprocessProject(project);

		expect(migrated.sourceAssets.activeImage).toBe('he');
		expect(migrated.sourceAssets.images.he).toBeNull();
		expect('eosin' in migrated.sourceAssets.images).toBe(false);
	});

	it('preserves a matrix-first tissueSelection and drops legacy region-first fields', () => {
		const project = buildCanonicalProject();
		const matrix = buildMatrix();
		project.tissueSelection = {
			...project.tissueSelection,
			status: 'complete',
			mode: 'matrix',
			thresholdMode: 'gray-min',
			matrix,
			supportState: 'supported',
			selectedSpotIds: ['spot-a'],
			// Legacy region-first compat fields that must be dropped.
			regions: [
				{
					id: 'region-1',
					label: 'Region 1',
					color: '#ff0000',
					points: [{ x: 0, y: 0 }],
				},
			],
			selectedRegionId: 'region-1',
			forcedInSpotIds: ['spot-a'],
			forcedOutSpotIds: [],
			overrideNotice: 'legacy',
			previewDataUrl: 'data:',
		};

		const migrated = migratePreprocessProject(project);
		const tissue = migrated.tissueSelection;

		expect(tissue.status).toBe('complete');
		expect(tissue.mode).toBe('matrix');
		expect(tissue.thresholdMode).toBe('gray-min');
		expect(tissue.supportState).toBe('supported');
		expect(tissue.matrix).toEqual(matrix);
		expect(tissue.selectedSpotIds).toEqual(['spot-a']);
		// Legacy region-first compat fields are not carried through.
		expect(tissue.regions).toBeUndefined();
		expect(tissue.selectedRegionId).toBeUndefined();
		expect(tissue.forcedInSpotIds).toBeUndefined();
		expect(tissue.forcedOutSpotIds).toBeUndefined();
		expect(tissue.overrideNotice).toBeUndefined();
		expect(tissue.previewDataUrl).toBeUndefined();
	});
});
