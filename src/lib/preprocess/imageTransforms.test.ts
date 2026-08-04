import { describe, expect, it } from 'vitest';
import type { LocalizationImageTransform, PreprocessPoint, PreprocessRect } from '@/types/preprocess';
import {
	applyImageDisplayTransform,
	getLowerLeftMarkerPoints,
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
		name: 'combined horizontal flip + rotation (flip applied in source frame)',
		transform: { rotationDegrees: 90, flipHorizontal: true, flipVertical: false, scale: 1 },
		point: { x: 0.12, y: 0.73 },
		expected: { x: 0.27, y: 0.88 },
	},
	{
		name: 'vertical flip keeps rotate-left moving the visible top to the left',
		transform: { rotationDegrees: -90, flipHorizontal: false, flipVertical: true, scale: 1 },
		point: { x: 0.5, y: 1 },
		expected: { x: 0, y: 0.5 },
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

	it('applies horizontal flips in the source coordinate system before rotation', () => {
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

		expectPointCloseTo(displayPoint, { x: 580, y: 540 });
		expectPointCloseTo(
			invertDisplayRectPointToSource(displayPoint, transform, displayRect),
			sourcePoint,
		);
	});

	it('keeps the visual rotation direction independent of flips (rotate-left after vertical flip)', () => {
		const transform: LocalizationImageTransform = {
			rotationDegrees: -90,
			flipHorizontal: false,
			flipVertical: true,
			scale: 1,
		};
		// After a vertical flip the visible top edge is the source bottom edge;
		// "rotate left" must still move the visible top edge to the left.
		const visibleTopAfterRotateLeft = applyImageDisplayTransform({ x: 0.5, y: 1 }, transform);

		expectPointCloseTo(visibleTopAfterRotateLeft, { x: 0, y: 0.5 });
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
});
