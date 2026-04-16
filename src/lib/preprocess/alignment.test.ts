import { describe, expect, it } from 'vitest';
import type { AlignmentControlPoint } from '@/types/preprocess';
import {
	AUTO_ECC_MIN,
	applyAcceptedAutoAlignment,
	classifyAutoRefinementOutcome,
	computeAlignmentStatus,
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

	it('downgrades weak ecc refinement to manual-required fallback', () => {
		const result = classifyAutoRefinementOutcome({
			coarseBounds: { x: 0.12, y: 0.18, width: 0.4, height: 0.42 },
			eccCorrelation: AUTO_ECC_MIN - 0.01,
			acceptedTransform: null,
			failureReason: 'ecc-below-threshold',
		});

		expect(result.accepted).toBe(false);
		expect(result.fallbackReason).toBe('ecc-rejected');
	});

	it('converts an accepted auto refinement into canonical complete alignment state', () => {
		const acceptedTransform: NonNullable<
			Parameters<typeof applyAcceptedAutoAlignment>[0]['acceptedTransform']
		> = {
			affineMatrix: [1.25, 0.1, 12, -0.05, 1.2, -8],
			transform: {
				translationX: 12,
				translationY: -8,
				rotationDegrees: -2.2906100426385296,
				scaleX: 1.2509996003196804,
				scaleY: 1.2041594578792296,
				isUniformScale: false,
			},
		};
		const result = applyAcceptedAutoAlignment({
			current: {
				status: 'ready',
				isStale: false,
				updatedAt: null,
				error: null,
				referenceImage: 'eosin',
				movingImage: 'he',
				movingImageTransform: {
					rotationDegrees: 0,
					flipHorizontal: false,
					flipVertical: false,
					scale: 1,
				},
				overlayOpacity: 0.5,
				source: null,
				controlPoints: [],
				inlierMask: null,
				affineMatrix: null,
				reprojectionRmse: null,
				inlierRatio: null,
				ransacReprojThreshold: null,
				qualityFlags: {
					minPairs: false,
					inlierRatio: false,
					rmse: false,
					finiteMatrix: false,
					scaleRange: false,
					accepted: false,
				},
				solveAccepted: false,
				failureReason: null,
				transform: null,
				previewDataUrl: null,
			},
			autoProposal: {
				status: 'accepted',
				method: 'mask-ecc-v1',
				coarseBounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
				refinedBounds: { x: 0.2, y: 0.25, width: 0.4, height: 0.3 },
				refinedQuad: null,
				rotationDegrees: 0,
				eccCorrelation: AUTO_ECC_MIN,
				failureReason: null,
			},
			acceptedTransform,
			hasReferenceImage: true,
			hasMovingImage: true,
		});

		expect(result).not.toBeNull();
		expect(result?.source).toBe('auto');
		expect(result?.solveAccepted).toBe(true);
		expect(result?.status).toBe('complete');
		expect(result?.qualityFlags.accepted).toBe(true);
		expect(result?.inlierRatio).toBe(1);
		expect(result?.affineMatrix).toEqual(acceptedTransform.affineMatrix);
		expect(result?.transform).toEqual(acceptedTransform.transform);
		expect(result?.reprojectionRmse).toBe(0);
	});

	it('classifies explicit automatic refinement fallback reasons for later tasks', () => {
		expect(
			classifyAutoRefinementOutcome({
				coarseBounds: null,
				eccCorrelation: null,
				acceptedTransform: null,
				failureReason: 'no-coarse-match',
			}),
		).toEqual({
			accepted: false,
			fallbackReason: 'no-proposal',
		});

		expect(
			classifyAutoRefinementOutcome({
				coarseBounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
				eccCorrelation: null,
				acceptedTransform: null,
				failureReason: 'ecc-failed',
			}),
		).toEqual({
			accepted: false,
			fallbackReason: 'ecc-failed',
		});

		expect(
			classifyAutoRefinementOutcome({
				coarseBounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
				eccCorrelation: null,
				acceptedTransform: null,
				failureReason: null,
			}),
		).toEqual({
			accepted: false,
			fallbackReason: 'manual-required',
		});
	});
});
