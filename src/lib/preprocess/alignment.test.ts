import { describe, expect, it } from 'vitest';
import type { AlignmentControlPoint } from '@/types/preprocess';
import { solveAffineAlignment } from './alignment';
import type { CvMat, OpenCvRuntime } from './loadOpenCv';

class FakeMat implements CvMat {
	rows: number;
	cols: number;
	data64F: Float64Array;
	data32F: Float32Array;
	data: Uint8Array;

	constructor(rows = 0, cols = 0, values: ArrayLike<number> = []) {
		this.rows = rows;
		this.cols = cols;
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

describe('solveAffineAlignment', () => {
	it('uses every marked point in all-points mode without filtering them into valid inliers', () => {
		const result = solveAffineAlignment({
			cv: fakeCv,
			controlPoints,
			chipBounds: null,
			referenceImageSize: { width: 1000, height: 1000 },
			movingImageSize: { width: 1000, height: 1000 },
			solveMode: 'allPoints',
		});

		expect(result.solveAccepted).toBe(true);
		expect(result.failureReason).toBeNull();
		expect(result.inlierMask).toEqual(Array.from({ length: controlPoints.length }, () => true));
		expect(result.inlierRatio).toBe(1);
		expect(result.affineMatrix).not.toBeNull();
	});
});
