import { describe, expect, it } from 'vitest';

import {
	buildEmptyPreprocessProject,
	normalizeProjectForPersistence,
	normalizeProjectForWorkspace,
} from './projectState';

describe('preprocess project state normalization', () => {
	it('builds an empty project on the source-assets step with an HE-only image set', () => {
		const project = buildEmptyPreprocessProject('Empty project');

		expect(project.currentStep).toBe('sourceAssets');
		expect(project.sourceAssets.activeImage).toBe('he');
		expect(project.sourceAssets.images.he).toBeNull();
		expect(project.chipConfig.chipType).toBeNull();
		expect(project.chipConfig.projectedSpots).toBeNull();
		expect(project.tissueSelection.matrix).toBeNull();
		expect(project.workflowVersion).toBeGreaterThan(0);
	});

	it('preserves the project through persistence and workspace normalization', () => {
		const project = buildEmptyPreprocessProject('Round trip');
		// normalizeProjectForWorkspace runs the migrator, which floors
		// workflowVersion up to the current version (4) and storageVersion to the
		// current schema version; persistence is a passthrough.
		const expectedWorkspace = {
			...project,
			workflowVersion: Math.max(project.workflowVersion, 4),
		};

		expect(normalizeProjectForPersistence(project)).toEqual(project);
		expect(normalizeProjectForWorkspace(project)).toEqual(expectedWorkspace);
	});

	it('keeps chipConfig and tissueSelection fields stable through normalization', () => {
		const project = buildEmptyPreprocessProject('Field stability');
		project.chipConfig.chipType = '15um';
		project.chipConfig.rows = 96;
		project.chipConfig.columns = 96;
		project.tissueSelection.mode = 'imported';

		const normalized = normalizeProjectForPersistence(project);

		expect(normalized.chipConfig.chipType).toBe('15um');
		expect(normalized.chipConfig.rows).toBe(96);
		expect(normalized.tissueSelection.mode).toBe('imported');
	});
});
