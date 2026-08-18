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

	it('preserves explicitly stored crop geometry when the slice is stale', () => {
		const project = buildEmptyPreprocessProject('stale geometry contract');
		project.cropQc.status = 'stale';
		project.cropQc.isStale = true;
		project.cropQc.eosinReferenceGeometry = {
			rect: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 },
			width: 640,
			height: 640,
		};
		project.cropQc.heQcGeometry = {
			rect: { x: 0.15, y: 0.25, width: 0.45, height: 0.45 },
			width: 640,
			height: 640,
		};

		const normalized = normalizeProjectForPersistence(project);

		// A "Reject to alignment" marks the slice stale but keeps the canonical
		// crop evidence; normalizing (and therefore autosaving) must not null it.
		expect(normalized.cropQc.eosinReferenceGeometry).toEqual(
			project.cropQc.eosinReferenceGeometry,
		);
		expect(normalized.cropQc.heQcGeometry).toEqual(project.cropQc.heQcGeometry);
		expect(normalized.cropQc.cropRect).toEqual(project.cropQc.eosinReferenceGeometry.rect);
		expect(normalized.cropQc.cropWidth).toBe(640);
		expect(normalized.cropQc.cropHeight).toBe(640);
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
