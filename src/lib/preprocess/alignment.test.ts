import { describe, expect, it } from 'vitest';
import type { AlignmentControlPoint } from '@/types/preprocess';
import { computeAlignmentStatus, solveAffineAlignment } from './alignment';
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
});
