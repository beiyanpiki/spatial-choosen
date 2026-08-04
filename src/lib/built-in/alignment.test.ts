import { describe, expect, it } from 'vitest';
import type { AlignmentControlPoint } from '@/types/built-in';
import {
	ALIGNMENT_COVERAGE_THRESHOLD,
	computeAlignmentStatus,
	computeCoverageWarning,
	solveAffineAlignment,
} from './alignment';
import type { CvMat, OpenCvRuntime } from './loadOpenCv';

class FakeMat implements CvMat {
	rows: number;
	cols: number;
	data64F: Float64Array;
	data32F: Float32Array;
	data: Uint8Array;

	constructor(...args: unknown[]) {
		const [rowsArg = 0, colsArg = 0, valuesArg = []] = args;
		const values = typeof valuesArg === 'object' && valuesArg !== null && 'length' in valuesArg
			? Array.from(valuesArg as ArrayLike<number>)
			: [];

		this.rows = typeof rowsArg === 'number' ? rowsArg : 0;
		this.cols = typeof colsArg === 'number' ? colsArg : 0;
		this.data64F = Float64Array.from(values);
		this.data32F = Float32Array.from(values);
		this.data = new Uint8Array();
	}

	empty() {
		return this.data64F.length === 0 && this.data32F.length === 0;
	}

	delete() {
		return;
	}
}

const fakeCv: OpenCvRuntime = {
	Mat: FakeMat,
	matFromArray: (rows, cols, _type, data) => new FakeMat(rows, cols, data),
	estimateAffine2D: () => new FakeMat(),
	warpAffine: () => undefined,
	matFromImageData: () => new FakeMat(),
	Size: class {
		constructor(...args: unknown[]) {
			void args;
		}
	},
	Scalar: class {
		constructor(...args: unknown[]) {
			void args;
		}
	},
	RANSAC: 0,
	CV_64F: 0,
	CV_8U: 0,
	INTER_LINEAR: 0,
	BORDER_CONSTANT: 0,
};

const controlPoints: AlignmentControlPoint[] = [
	{
		id: 'p1',
		target: { x: 0.1, y: 0.1 },
		source: { x: 0.2, y: 0.15 },
	},
	{
		id: 'p2',
		target: { x: 0.2, y: 0.3 },
		source: { x: 0.3, y: 0.35 },
	},
	{
		id: 'p3',
		target: { x: 0.4, y: 0.2 },
		source: { x: 0.5, y: 0.25 },
	},
	{
		id: 'p4',
		target: { x: 0.6, y: 0.6 },
		source: { x: 0.1, y: 0.9 },
	},
	{
		id: 'p5',
		target: { x: 0.7, y: 0.2 },
		source: { x: 0.9, y: 0.8 },
	},
	{
		id: 'p6',
		target: { x: 0.3, y: 0.8 },
		source: { x: 0.7, y: 0.1 },
	},
	{
		id: 'p7',
		target: { x: 0.9, y: 0.4 },
		source: { x: 0.2, y: 0.2 },
	},
	{
		id: 'p8',
		target: { x: 0.5, y: 0.9 },
		source: { x: 0.05, y: 0.05 },
	},
];

const acceptedControlPoints: AlignmentControlPoint[] = [
	{
		id: 'a1',
		target: { x: 0.1, y: 0.1 },
		source: { x: 0.14, y: 0.13 },
	},
	{
		id: 'a2',
		target: { x: 0.9, y: 0.1 },
		source: { x: 0.86, y: 0.13 },
	},
	{
		id: 'a3',
		target: { x: 0.1, y: 0.9 },
		source: { x: 0.14, y: 0.85 },
	},
	{
		id: 'a4',
		target: { x: 0.9, y: 0.9 },
		source: { x: 0.86, y: 0.85 },
	},
	{
		id: 'a5',
		target: { x: 0.5, y: 0.2 },
		source: { x: 0.5, y: 0.22 },
	},
	{
		id: 'a6',
		target: { x: 0.2, y: 0.5 },
		source: { x: 0.23, y: 0.49 },
	},
	{
		id: 'a7',
		target: { x: 0.35, y: 0.75 },
		source: { x: 0.365, y: 0.715 },
	},
	{
		id: 'a8',
		target: { x: 0.75, y: 0.35 },
		source: { x: 0.725, y: 0.355 },
	},
];

const weakManualControlPoints: AlignmentControlPoint[] = [
	{
		id: 'w1',
		target: { x: 0.08, y: 0.08 },
		source: { x: 0.11, y: 0.1 },
	},
	{
		id: 'w2',
		target: { x: 0.92, y: 0.08 },
		source: { x: 0.95, y: 0.1 },
	},
	{
		id: 'w3',
		target: { x: 0.08, y: 0.92 },
		source: { x: 0.11, y: 0.94 },
	},
	{
		id: 'w4',
		target: { x: 0.92, y: 0.92 },
		source: { x: 0.95, y: 0.94 },
	},
	{
		id: 'w5',
		target: { x: 0.2, y: 0.2 },
		source: { x: 0.81, y: 0.79 },
	},
	{
		id: 'w6',
		target: { x: 0.35, y: 0.2 },
		source: { x: 0.78, y: 0.22 },
	},
	{
		id: 'w7',
		target: { x: 0.5, y: 0.2 },
		source: { x: 0.18, y: 0.82 },
	},
	{
		id: 'w8',
		target: { x: 0.65, y: 0.2 },
		source: { x: 0.24, y: 0.68 },
	},
	{
		id: 'w9',
		target: { x: 0.8, y: 0.2 },
		source: { x: 0.13, y: 0.54 },
	},
	{
		id: 'w10',
		target: { x: 0.2, y: 0.5 },
		source: { x: 0.74, y: 0.16 },
	},
	{
		id: 'w11',
		target: { x: 0.5, y: 0.5 },
		source: { x: 0.16, y: 0.18 },
	},
	{
		id: 'w12',
		target: { x: 0.8, y: 0.5 },
		source: { x: 0.88, y: 0.3 },
	},
	{
		id: 'w13',
		target: { x: 0.3, y: 0.8 },
		source: { x: 0.62, y: 0.12 },
	},
	{
		id: 'w14',
		target: { x: 0.7, y: 0.8 },
		source: { x: 0.36, y: 0.64 },
	},
];

const createLooseScaleControlPoints = (): AlignmentControlPoint[] => {
	const scale = 0.006;
	const translationX = 75;
	const translationY = 431;
	const referenceWidth = 1000;
	const referenceHeight = 1000;
	const movingWidth = 160000;
	const movingHeight = 160000;
	const movingPoints = [
		{ x: 10000, y: 10000 },
		{ x: 140000, y: 10000 },
		{ x: 10000, y: 140000 },
		{ x: 140000, y: 140000 },
		{ x: 80000, y: 16000 },
		{ x: 16000, y: 80000 },
		{ x: 80000, y: 150000 },
		{ x: 150000, y: 80000 },
	];

	return movingPoints.map((target, index) => ({
		id: `loose-scale-${index + 1}`,
		target: {
			x: target.x / movingWidth,
			y: target.y / movingHeight,
		},
		source: {
			x: (scale * target.x + translationX) / referenceWidth,
			y: (scale * target.y + translationY) / referenceHeight,
		},
	}));
};

describe('computeCoverageWarning', () => {
	it('accepts landmark coverage matching a small 28.3% by 30.7% tissue area', () => {
		const coverage = computeCoverageWarning(
			[
				{
					id: 'small-tissue-a',
					source: { x: 0.1, y: 0.1 },
					target: { x: 0.12, y: 0.11 },
				},
				{
					id: 'small-tissue-b',
					source: { x: 0.383, y: 0.407 },
					target: { x: 0.4, y: 0.42 },
				},
			],
			{ x: 0, y: 0, width: 1, height: 1 },
		);

		expect(ALIGNMENT_COVERAGE_THRESHOLD).toBe(0.2);
		expect(coverage.coverageRatioX).toBeCloseTo(0.283, 6);
		expect(coverage.coverageRatioY).toBeCloseTo(0.307, 6);
		expect(coverage.warning).toBe(false);
	});

	it('continues warning when either landmark axis covers less than 20%', () => {
		const coverage = computeCoverageWarning(
			[
				{
					id: 'narrow-a',
					source: { x: 0.1, y: 0.1 },
					target: { x: 0.1, y: 0.1 },
				},
				{
					id: 'narrow-b',
					source: { x: 0.299, y: 0.6 },
					target: { x: 0.3, y: 0.6 },
				},
			],
			{ x: 0, y: 0, width: 1, height: 1 },
		);

		expect(coverage.warning).toBe(true);
	});
});

describe('solveAffineAlignment', () => {
	it('keeps every marked point in all-points mode while strict acceptance rejects the solve', () => {
		const result = solveAffineAlignment({
			cv: fakeCv,
			controlPoints,
			chipBounds: null,
			referenceImageSize: { width: 1000, height: 1000 },
			movingImageSize: { width: 1000, height: 1000 },
			solveMode: 'allPoints',
		});

		expect(result.solveAccepted).toBe(false);
		expect(result.qualityFlags.accepted).toBe(false);
		expect(result.failureReason).not.toBeNull();
		expect(result.inlierMask).toEqual(Array.from({ length: controlPoints.length }, () => true));
		expect(result.inlierRatio).toBe(1);
		expect(result.affineMatrix).not.toBeNull();
	});

	it('keeps solveAccepted separate from strict quality acceptance in all-points mode', () => {
		const result = solveAffineAlignment({
			cv: fakeCv,
			controlPoints,
			chipBounds: null,
			referenceImageSize: { width: 1000, height: 1000 },
			movingImageSize: { width: 1000, height: 1000 },
			solveMode: 'allPoints',
		});

		expect(result.affineMatrix).not.toBeNull();
		expect(result.qualityFlags.accepted).toBe(false);
		expect(result.solveAccepted).toBe(false);
		expect(result.failureReason).not.toBeNull();
		expect(
			computeAlignmentStatus({
				hasReferenceImage: true,
				hasMovingImage: true,
				solveAccepted: result.solveAccepted,
				failureReason: result.failureReason,
			}),
		).not.toBe('complete');
	});

	it('accepts a clean all-points solve and reports a complete alignment status', () => {
		const result = solveAffineAlignment({
			cv: fakeCv,
			controlPoints: acceptedControlPoints,
			chipBounds: null,
			referenceImageSize: { width: 1000, height: 1000 },
			movingImageSize: { width: 1000, height: 1000 },
			solveMode: 'allPoints',
		});

		expect(result.affineMatrix).not.toBeNull();
		expect(result.qualityFlags.accepted).toBe(true);
		expect(result.solveAccepted).toBe(true);
		expect(
			computeAlignmentStatus({
				hasReferenceImage: true,
				hasMovingImage: true,
				solveAccepted: result.solveAccepted,
				failureReason: result.failureReason,
			}),
		).toBe('complete');
	});

	it('rejects manual solve below minimum inliers and coverage', () => {
		const result = solveAffineAlignment({
			cv: fakeCv,
			controlPoints: weakManualControlPoints,
			chipBounds: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
			referenceImageSize: { width: 1000, height: 1000 },
			movingImageSize: { width: 1000, height: 1000 },
		});

		expect(result.inlierMask.filter(Boolean)).toHaveLength(4);
		expect(result.inlierRatio).toBeCloseTo(4 / 14, 6);
		expect(result.qualityFlags.inlierRatio).toBe(false);
		expect(result.qualityFlags.accepted).toBe(false);
		expect(result.solveAccepted).toBe(false);
		expect(result.failureReason).toBe('insufficient-inliers');
	});

	it('accepts a clean solve when valid image scales are far below the former strict minimum', () => {
		const result = solveAffineAlignment({
			cv: fakeCv,
			controlPoints: createLooseScaleControlPoints(),
			chipBounds: { x: 0, y: 0, width: 1, height: 1 },
			referenceImageSize: { width: 1000, height: 1000 },
			movingImageSize: { width: 160000, height: 160000 },
			solveMode: 'allPoints',
		});

		expect(result.qualityFlags.scaleRange).toBe(true);
		expect(result.qualityFlags.accepted).toBe(true);
		expect(result.solveAccepted).toBe(true);
		expect(result.transform?.scaleX).toBeCloseTo(0.006, 5);
		expect(result.transform?.scaleY).toBeCloseTo(0.006, 5);
	});


});
