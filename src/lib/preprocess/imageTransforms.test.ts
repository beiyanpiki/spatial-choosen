import { describe, expect, it } from 'vitest';
import type { LocalizationImageTransform, PreprocessPoint, PreprocessRect } from '@/types/preprocess';
import {
	applyImageDisplayTransform,
	getLowerLeftMarkerPoints,
	getOrientedChipBoundsPixelRect,
	getTransformedRectCorners,
	invertDisplayRectPointToSource,
	invertImageDisplayTransform,
	projectSourcePointToDisplayRect,
} from './imageTransforms';

const expectPointCloseTo = (actual: PreprocessPoint, expected: PreprocessPoint) => {
	expect(actual.x).toBeCloseTo(expected.x, 6);
	expect(actual.y).toBeCloseTo(expected.y, 6);
};

const basePoint: PreprocessPoint = { x: 0.2, y: 0.8 };

const transforms: Array<{ name: string; transform: LocalizationImageTransform; expected: PreprocessPoint; point?: PreprocessPoint }> = [
	{
		name: 'rotation 0',
		transform: { rotationDegrees: 0, flipHorizontal: false, flipVertical: false, scale: 1 },
		expected: { x: 0.2, y: 0.8 },
	},
	{
		name: 'rotation 90',
		transform: { rotationDegrees: 90, flipHorizontal: false, flipVertical: false, scale: 1 },
		expected: { x: 0.2, y: 0.2 },
	},
	{
		name: 'rotation 180',
		transform: { rotationDegrees: 180, flipHorizontal: false, flipVertical: false, scale: 1 },
		expected: { x: 0.8, y: 0.2 },
	},
	{
		name: 'rotation -90',
		transform: { rotationDegrees: -90, flipHorizontal: false, flipVertical: false, scale: 1 },
		expected: { x: 0.8, y: 0.8 },
	},
	{
		name: 'horizontal flip',
		transform: { rotationDegrees: 0, flipHorizontal: true, flipVertical: false, scale: 1 },
		expected: { x: 0.8, y: 0.8 },
	},
	{
		name: 'vertical flip',
		transform: { rotationDegrees: 0, flipHorizontal: false, flipVertical: true, scale: 1 },
		expected: { x: 0.2, y: 0.2 },
	},
	{
		name: 'combined rotation + view-horizontal flip',
		transform: { rotationDegrees: 90, flipHorizontal: true, flipVertical: false, scale: 1 },
		point: { x: 0.12, y: 0.73 },
		expected: { x: 0.73, y: 0.12 },
	},
];

describe('imageTransforms', () => {
	it.each(transforms)('round-trips $name through display transform inversion', ({ transform, expected, point }) => {
		const sourcePoint = point ?? basePoint;
		const displayPoint = applyImageDisplayTransform(sourcePoint, transform);

		expectPointCloseTo(displayPoint, expected);
		expectPointCloseTo(invertImageDisplayTransform(displayPoint, transform), sourcePoint);
	});

	it('projects and inverts source points through a non-square display rectangle', () => {
		const transform: LocalizationImageTransform = {
			rotationDegrees: 90,
			flipHorizontal: false,
			flipVertical: false,
			scale: 1,
		};
		const displayRect = {
			originX: 0,
			originY: 0,
			width: 800,
			height: 600,
		};
		const sourcePoint = { x: 0.2, y: 0.2 };

		const displayPoint = projectSourcePointToDisplayRect(sourcePoint, transform, displayRect);

		expectPointCloseTo(displayPoint, { x: 580, y: 60 });
		expectPointCloseTo(
			invertDisplayRectPointToSource(displayPoint, transform, displayRect),
			sourcePoint,
		);
	});

	it('applies horizontal flips in the rotated display coordinate system', () => {
		const transform: LocalizationImageTransform = {
			rotationDegrees: 90,
			flipHorizontal: true,
			flipVertical: false,
			scale: 1,
		};
		const displayRect = {
			originX: 0,
			originY: 0,
			width: 800,
			height: 600,
		};
		const sourcePoint = { x: 0.2, y: 0.2 };

		const displayPoint = projectSourcePointToDisplayRect(sourcePoint, transform, displayRect);

		expectPointCloseTo(displayPoint, { x: 220, y: 60 });
		expectPointCloseTo(
			invertDisplayRectPointToSource(displayPoint, transform, displayRect),
			sourcePoint,
		);
	});

	it('transforms off-axis rect corners under 90 degree rotation', () => {
		const rect: PreprocessRect = { x: 0.2, y: 0.35, width: 0.1, height: 0.2 };
		const transform: LocalizationImageTransform = {
			rotationDegrees: 90,
			flipHorizontal: false,
			flipVertical: false,
			scale: 1,
		};

		const corners = getTransformedRectCorners(rect, transform);

		expectPointCloseTo(corners[0], { x: 0.65, y: 0.2 });
		expectPointCloseTo(corners[1], { x: 0.65, y: 0.3 });
		expectPointCloseTo(corners[2], { x: 0.45, y: 0.3 });
		expectPointCloseTo(corners[3], { x: 0.45, y: 0.2 });
	});

	it('keeps lower-left marker points anchored to the transformed source corner', () => {
		const rect: PreprocessRect = { x: 0.2, y: 0.35, width: 0.3, height: 0.2 };
		const transform: LocalizationImageTransform = {
			rotationDegrees: 90,
			flipHorizontal: false,
			flipVertical: false,
			scale: 1,
		};
		const markerPoints = getLowerLeftMarkerPoints(rect, transform);
		const lowerLeftCorner = applyImageDisplayTransform({ x: rect.x, y: rect.y + rect.height }, transform);

		expectPointCloseTo(markerPoints[1], lowerLeftCorner);
		expectPointCloseTo(markerPoints[0], { x: 0.49, y: 0.2 });
		expectPointCloseTo(markerPoints[2], { x: 0.45, y: 0.24 });
	});

	it('maps canvas-axis chip bounds directly onto the oriented pixel frame under rotation', () => {
		// A 4504x4096 source rotated 90 degrees is displayed in a 4096x4504 oriented
		// frame; the box the user draws on that frame must crop that same frame.
		const rect: PreprocessRect = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
		const orientedRect = getOrientedChipBoundsPixelRect(
			rect,
			{ width: 4096, height: 4504 },
		);

		expect(orientedRect).toEqual({
			x: Math.round(0.1 * 4096),
			y: Math.round(0.2 * 4504),
			width: Math.round(0.3 * 4096),
			height: Math.round(0.4 * 4504),
		});
	});

	it('maps canvas-axis chip bounds without mirroring when flips are active', () => {
		const rect: PreprocessRect = { x: 0.05, y: 0.1, width: 0.25, height: 0.5 };
		// The oriented frame size equals the source size at rotation 0; a flip
		// mirrors the content inside the frame, not the frame coordinates, so the
		// crop rect must not be mirrored either.
		const orientedRect = getOrientedChipBoundsPixelRect(
			rect,
			{ width: 400, height: 300 },
		);

		expect(orientedRect).toEqual({
			x: Math.round(rect.x * 400),
			y: Math.round(rect.y * 300),
			width: Math.round(rect.width * 400),
			height: Math.round(rect.height * 300),
		});
		// Sanity: the old double-transform behavior would have mirrored this rect.
		expect(orientedRect.x).toBeLessThan(400 / 2);
	});
});
