import { describe, expect, it } from 'vitest';

import {
	buildEmptyPreprocessProject,
	normalizeHeFocusSlice,
	normalizeProjectForPersistence,
	normalizeProjectForWorkspace,
} from './projectState';

describe('HEFocus project state normalization', () => {
	it('preserves out-of-bounds HEFocus bounds without broadening localization clamping', () => {
		const project = buildEmptyPreprocessProject('HEFocus normalization contract');
		const localizationBounds = {
			x: -0.2,
			y: 0.1,
			width: 0.4,
			height: 0.4,
		};
		const heFocusBounds = {
			x: -0.25,
			y: 0.82,
			width: 0.45,
			height: 0.45,
		};

		project.localization.chipBounds = localizationBounds;
		project.localization.handles = [];
		project.heFocus.chipBounds = heFocusBounds;
		project.heFocus.handles = [];

		const normalized = normalizeProjectForPersistence(project);

		expect(normalized.localization.chipBounds).toEqual({
			x: 0,
			y: 0.1,
			width: 0.4,
			height: 0.4,
		});
		expect(normalized.heFocus.chipBounds).toEqual(heFocusBounds);
		expect(normalized.heFocus.handles).toEqual([
			{ id: 'nw', label: 'NW', point: { x: -0.25, y: 0.82 } },
			{ id: 'ne', label: 'NE', point: { x: 0.2, y: 0.82 } },
			{ id: 'se', label: 'SE', point: { x: 0.2, y: 1.27 } },
			{ id: 'sw', label: 'SW', point: { x: -0.25, y: 1.27 } },
		]);
	});

	it('keeps fully outside HEFocus bounds representable during workspace normalization', () => {
		const project = buildEmptyPreprocessProject('HEFocus workspace contract');
		const heFocusBounds = {
			x: 1.18,
			y: 1.12,
			width: 0.24,
			height: 0.24,
		};

		project.heFocus.chipBounds = heFocusBounds;
		project.heFocus.handles = [];

		expect(normalizeHeFocusSlice(project.heFocus).chipBounds).toEqual(heFocusBounds);
		expect(normalizeProjectForWorkspace(project).heFocus.chipBounds).toEqual(
			heFocusBounds,
		);
	});
});
