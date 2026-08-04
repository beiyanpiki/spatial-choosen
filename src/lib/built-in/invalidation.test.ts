import { describe, expect, it } from 'vitest';

import { buildEmptyPreprocessProject } from '@/app/built-in/projectState';

import {
	PREPROCESS_INVALIDATION_GRAPH,
	getInvalidatedSteps,
	invalidateFromStep,
	invalidateOnSourceAssetsChange,
	invalidateOnTissueSelectionChange,
} from './invalidation';

describe('preprocess invalidation contract', () => {
	it('exposes an empty downstream invalidation graph for the simplified workflow', () => {
		expect(PREPROCESS_INVALIDATION_GRAPH).toEqual({
			sourceAssets: [],
			tissueSelection: [],
		});
	});

	it('reports no invalidated downstream steps for any step id', () => {
		expect(getInvalidatedSteps('sourceAssets')).toEqual([]);
		expect(getInvalidatedSteps('tissueSelection')).toEqual([]);
	});

	it('invalidateFromStep is a no-op because the graph has no downstream entries', () => {
		const project = buildEmptyPreprocessProject('test');

		expect(invalidateFromStep(project, 'sourceAssets')).toBe(project);
		expect(invalidateFromStep(project, 'tissueSelection')).toBe(project);
	});

	it('invalidateOnSourceAssetsChange marks the sourceAssets slice stale', () => {
		const project = buildEmptyPreprocessProject('test');

		const invalidated = invalidateOnSourceAssetsChange(project);

		expect(invalidated.sourceAssets.status).toBe('stale');
		expect(invalidated.sourceAssets.isStale).toBe(true);
		expect(invalidated.sourceAssets.error).toBeNull();
	});

	it('invalidateOnTissueSelectionChange marks tissueSelection stale and clears derived selection state', () => {
		const project = buildEmptyPreprocessProject('test');
		project.tissueSelection = {
			...project.tissueSelection,
			status: 'complete',
			isStale: false,
			selectedSpotIds: ['spot-a', 'spot-b'],
			paritySummary: {
				selectedCount: 2,
				selectedPercent: 50,
				maskCoverage: 0.5,
			},
			previewDataUrl: 'blob:tissue-preview',
		};

		const invalidated = invalidateOnTissueSelectionChange(project);

		expect(invalidated.tissueSelection.status).toBe('stale');
		expect(invalidated.tissueSelection.isStale).toBe(true);
		expect(invalidated.tissueSelection.selectedSpotIds).toBeNull();
		expect(invalidated.tissueSelection.paritySummary).toBeNull();
		expect(invalidated.tissueSelection.previewDataUrl).toBeNull();
	});
});
