import type {
	AlignmentAffineMatrix,
	AlignmentControlPoint,
	AlignmentFailureReason,
	AlignmentQualityFlags,
	AlignmentSlice,
	AlignmentTransform,
	LocalizationImageTransform,
	PreprocessRect,
	PreprocessStepStatus,
} from "@/types/preprocess";
import type { CvMat, OpenCvRuntime } from "./loadOpenCv";
import { normalizeLocalizationImageTransform } from "./localization";

export const ALIGNMENT_MIN_PAIRS = 7;
export const ALIGNMENT_TARGET_PAIRS = 15;
export const MANUAL_MIN_INLIERS = 6;
export const MANUAL_MIN_INLIER_RATIO = 0.5;
export const MANUAL_MIN_COVERAGE = 0.35;
export const ALIGNMENT_COVERAGE_THRESHOLD = MANUAL_MIN_COVERAGE;
export const ALIGNMENT_SCALE_MIN = 0.067;
export const ALIGNMENT_SCALE_MAX = 15;
export const ALIGNMENT_RANSAC_MAX_ITERS = 2000;
export const ALIGNMENT_RANSAC_CONFIDENCE = 0.99;
export const ALIGNMENT_RANSAC_REFINE_ITERS = 10;
export const ALIGNMENT_RMSE_MULTIPLIER = 6;

const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));

const defaultQualityFlags = (): AlignmentQualityFlags => ({
	minPairs: false,
	inlierRatio: false,
	rmse: false,
	finiteMatrix: false,
	scaleRange: false,
	accepted: false,
});

export type AlignmentCoverage = {
	spanX: number;
	spanY: number;
	coverageRatioX: number;
	coverageRatioY: number;
	warning: boolean;
};

export function computeCoverageWarning(
	points: readonly AlignmentControlPoint[],
	chipBounds: PreprocessRect | null,
	minimumCoverage = MANUAL_MIN_COVERAGE,
): AlignmentCoverage {
	if (points.length === 0) {
		return {
			spanX: 0,
			spanY: 0,
			coverageRatioX: 0,
			coverageRatioY: 0,
			warning: true,
		};
	}

	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;

	for (const point of points) {
		minX = Math.min(minX, point.source.x);
		minY = Math.min(minY, point.source.y);
		maxX = Math.max(maxX, point.source.x);
		maxY = Math.max(maxY, point.source.y);
	}

	const spanX = Math.max(0, maxX - minX);
	const spanY = Math.max(0, maxY - minY);
	const basisWidth = Math.max(1e-6, chipBounds?.width ?? 1);
	const basisHeight = Math.max(1e-6, chipBounds?.height ?? 1);
	const coverageRatioX = spanX / basisWidth;
	const coverageRatioY = spanY / basisHeight;

	return {
		spanX,
		spanY,
		coverageRatioX,
		coverageRatioY,
		warning:
			coverageRatioX < minimumCoverage || coverageRatioY < minimumCoverage,
	};
}

const safeNumber = (value: number, fallback = 0) =>
	Number.isFinite(value) ? value : fallback;

const deriveTransform = (matrix: AlignmentAffineMatrix): AlignmentTransform => {
	const [a, b, tx, c, d, ty] = matrix;
	const scaleX = Math.hypot(a, c);
	const scaleY = Math.hypot(b, d);
	const rotationDegrees = Math.atan2(c, a) * (180 / Math.PI);

	const isUniformScale = Math.abs(scaleX - scaleY) < 0.01 * Math.max(scaleX, scaleY);

	return {
		translationX: tx,
		translationY: ty,
		rotationDegrees,
		scaleX,
		scaleY,
		isUniformScale,
	};
};

type PixelPoint = { x: number; y: number };

type AffineFit = {
	matrix: AlignmentAffineMatrix;
	rmse: number;
};

type CandidateFit = AffineFit & {
	inlierMask: boolean[];
	inlierIndices: number[];
};

const computeReprojectionRmse = (
	fromPoints: readonly PixelPoint[],
	toPoints: readonly PixelPoint[],
	matrix: AlignmentAffineMatrix,
) => {
	const [m00, m01, tx, m10, m11, ty] = matrix;

	let errorSum = 0;
	for (let index = 0; index < fromPoints.length; index += 1) {
		const from = fromPoints[index];
		const to = toPoints[index];
		const projectedX = m00 * from.x + m01 * from.y + tx;
		const projectedY = m10 * from.x + m11 * from.y + ty;
		const dx = projectedX - to.x;
		const dy = projectedY - to.y;
		errorSum += dx * dx + dy * dy;
	}

	return Math.sqrt(errorSum / Math.max(1, fromPoints.length));
};

const solveLinearSystem = (
	matrix: number[][],
	vector: number[],
): number[] | null => {
	const size = vector.length;
	const augmented = matrix.map((row, index) => [...row, vector[index]]);

	for (let pivot = 0; pivot < size; pivot += 1) {
		let bestRow = pivot;
		let bestValue = Math.abs(augmented[pivot][pivot]);

		for (let row = pivot + 1; row < size; row += 1) {
			const candidateValue = Math.abs(augmented[row][pivot]);
			if (candidateValue > bestValue) {
				bestRow = row;
				bestValue = candidateValue;
			}
		}

		if (bestValue <= Number.EPSILON) return null;

		if (bestRow !== pivot) {
			const temp = augmented[pivot];
			augmented[pivot] = augmented[bestRow];
			augmented[bestRow] = temp;
		}

		const pivotValue = augmented[pivot][pivot];
		for (let column = pivot; column <= size; column += 1) {
			augmented[pivot][column] /= pivotValue;
		}

		for (let row = 0; row < size; row += 1) {
			if (row === pivot) continue;
			const factor = augmented[row][pivot];
			if (Math.abs(factor) <= Number.EPSILON) continue;
			for (let column = pivot; column <= size; column += 1) {
				augmented[row][column] -= factor * augmented[pivot][column];
			}
		}
	}

	return augmented.map((row) => row[size]);
};

const solveLeastSquaresAffineTransform = (
	fromPoints: readonly PixelPoint[],
	toPoints: readonly PixelPoint[],
): AffineFit | null => {
	if (fromPoints.length !== toPoints.length || fromPoints.length < 3)
		return null;

	const ata = Array.from({ length: 6 }, () =>
		Array.from({ length: 6 }, () => 0),
	);
	const atb = Array.from({ length: 6 }, () => 0);

	const accumulate = (row: readonly number[], target: number) => {
		for (let left = 0; left < 6; left += 1) {
			atb[left] += row[left] * target;
			for (let right = 0; right < 6; right += 1) {
				ata[left][right] += row[left] * row[right];
			}
		}
	};

	for (let index = 0; index < fromPoints.length; index += 1) {
		const from = fromPoints[index];
		const to = toPoints[index];
		accumulate([from.x, from.y, 1, 0, 0, 0], to.x);
		accumulate([0, 0, 0, from.x, from.y, 1], to.y);
	}

	const solution = solveLinearSystem(ata, atb);
	if (!solution) return null;

	const matrix: AlignmentAffineMatrix = [
		solution[0],
		solution[1],
		solution[2],
		solution[3],
		solution[4],
		solution[5],
	];

	return {
		matrix,
		rmse: computeReprojectionRmse(fromPoints, toPoints, matrix),
	};
};

const solveLeastSquaresSimilarityTransformVariant = (
	fromPoints: readonly PixelPoint[],
	toPoints: readonly PixelPoint[],
	options: { reflected: boolean },
): AffineFit | null => {
	if (fromPoints.length !== toPoints.length || fromPoints.length < 2) return null;

	const ata = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 0));
	const atb = Array.from({ length: 4 }, () => 0);

	const accumulate = (row: readonly number[], target: number) => {
		for (let left = 0; left < 4; left += 1) {
			atb[left] += row[left] * target;
			for (let right = 0; right < 4; right += 1) {
				ata[left][right] += row[left] * row[right];
			}
		}
	};

	for (let index = 0; index < fromPoints.length; index += 1) {
		const from = fromPoints[index];
		const to = toPoints[index];
		if (options.reflected) {
			accumulate([from.x, from.y, 1, 0], to.x);
			accumulate([from.y, -from.x, 0, 1], to.y);
		} else {
			accumulate([from.x, -from.y, 1, 0], to.x);
			accumulate([from.y, from.x, 0, 1], to.y);
		}
	}

	const solution = solveLinearSystem(ata, atb);
	if (!solution) return null;

	const [a, b, tx, ty] = solution;
	const matrix: AlignmentAffineMatrix = options.reflected
		? [a, b, tx, b, -a, ty]
		: [a, -b, tx, b, a, ty];

	return {
		matrix,
		rmse: computeReprojectionRmse(fromPoints, toPoints, matrix),
	};
};

const solveLeastSquaresBestSimilarityTransform = (
	fromPoints: readonly PixelPoint[],
	toPoints: readonly PixelPoint[],
): AffineFit | null => {
	const candidates = [
		solveLeastSquaresSimilarityTransformVariant(fromPoints, toPoints, {
			reflected: false,
		}),
		solveLeastSquaresSimilarityTransformVariant(fromPoints, toPoints, {
			reflected: true,
		}),
	].filter((candidate): candidate is AffineFit => candidate !== null);

	if (candidates.length === 0) return null;

	return candidates.reduce((best, candidate) =>
		candidate.rmse < best.rmse ? candidate : best,
	);
};

const solveFixedScaleSimilarityTransformVariant = (
	fromPoints: readonly PixelPoint[],
	toPoints: readonly PixelPoint[],
	scale: number,
	options: { reflected: boolean },
): AffineFit | null => {
	if (fromPoints.length !== toPoints.length || fromPoints.length < 2) return null;
	if (!Number.isFinite(scale) || scale <= 0) return null;

	const fromCenter = fromPoints.reduce(
		(acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
		{ x: 0, y: 0 },
	);
	fromCenter.x /= fromPoints.length;
	fromCenter.y /= fromPoints.length;

	const toCenter = toPoints.reduce(
		(acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
		{ x: 0, y: 0 },
	);
	toCenter.x /= toPoints.length;
	toCenter.y /= toPoints.length;

	let dot = 0;
	let cross = 0;
	for (let index = 0; index < fromPoints.length; index += 1) {
		const from = fromPoints[index];
		const to = toPoints[index];
		const dx = from.x - fromCenter.x;
		const dy = from.y - fromCenter.y;
		const ux = to.x - toCenter.x;
		const uy = to.y - toCenter.y;

		if (options.reflected) {
			dot += dx * ux - dy * uy;
			cross += dx * uy + dy * ux;
		} else {
			dot += dx * ux + dy * uy;
			cross += dx * uy - dy * ux;
		}
	}

	const rotationRadians = Math.atan2(cross, dot);
	const cosine = Math.cos(rotationRadians);
	const sine = Math.sin(rotationRadians);
	const matrix: AlignmentAffineMatrix = options.reflected
		? [
				scale * cosine,
				scale * sine,
				0,
				scale * sine,
				-scale * cosine,
				0,
			]
		: [
				scale * cosine,
				-scale * sine,
				0,
				scale * sine,
				scale * cosine,
				0,
			];

	matrix[2] =
		toCenter.x - matrix[0] * fromCenter.x - matrix[1] * fromCenter.y;
	matrix[5] =
		toCenter.y - matrix[3] * fromCenter.x - matrix[4] * fromCenter.y;

	return {
		matrix,
		rmse: computeReprojectionRmse(fromPoints, toPoints, matrix),
	};
};

const solveBestFixedScaleSimilarityTransform = (
	fromPoints: readonly PixelPoint[],
	toPoints: readonly PixelPoint[],
	scale: number,
): AffineFit | null => {
	const candidates = [
		solveFixedScaleSimilarityTransformVariant(fromPoints, toPoints, scale, {
			reflected: false,
		}),
		solveFixedScaleSimilarityTransformVariant(fromPoints, toPoints, scale, {
			reflected: true,
		}),
	].filter((candidate): candidate is AffineFit => candidate !== null);

	if (candidates.length === 0) return null;

	return candidates.reduce((best, candidate) =>
		candidate.rmse < best.rmse ? candidate : best,
	);
};

const solveBestFixedScaleSimilarityTransformNoReflection = (
	fromPoints: readonly PixelPoint[],
	toPoints: readonly PixelPoint[],
	scale: number,
): AffineFit | null => {
	return solveFixedScaleSimilarityTransformVariant(fromPoints, toPoints, scale, {
		reflected: false,
	});
};

const evaluateCandidateFit = (
	fromPoints: readonly PixelPoint[],
	toPoints: readonly PixelPoint[],
	fit: AffineFit,
	threshold: number,
): CandidateFit => {
	const [m00, m01, tx, m10, m11, ty] = fit.matrix;
	const inlierMask = fromPoints.map((from, index) => {
		const to = toPoints[index];
		const projectedX = m00 * from.x + m01 * from.y + tx;
		const projectedY = m10 * from.x + m11 * from.y + ty;
		return Math.hypot(projectedX - to.x, projectedY - to.y) <= threshold;
	});
	const inlierIndices = inlierMask
		.map((isInlier, index) => (isInlier ? index : -1))
		.filter((index) => index >= 0);
	const indices = inlierIndices.length > 0
		? inlierIndices
		: fromPoints.map((_, index) => index);
	const inlierFromPoints = indices.map((index) => fromPoints[index]);
	const inlierToPoints = indices.map((index) => toPoints[index]);

	return {
		matrix: fit.matrix,
		rmse: computeReprojectionRmse(inlierFromPoints, inlierToPoints, fit.matrix),
		inlierMask,
		inlierIndices,
	};
};

const solveRobustSimilarityTransform = (
	fromPoints: readonly PixelPoint[],
	toPoints: readonly PixelPoint[],
	threshold: number,
	options?: { forceNoReflection?: boolean },
): CandidateFit | null => {
	const { forceNoReflection = false } = options ?? {};
	if (fromPoints.length !== toPoints.length || fromPoints.length < 2) return null;

	let bestCandidate: CandidateFit | null = null;
	let bestErrorSum = Number.POSITIVE_INFINITY;

	for (let left = 0; left < fromPoints.length - 1; left += 1) {
		for (let right = left + 1; right < fromPoints.length; right += 1) {
			const pairFit = forceNoReflection
				? solveLeastSquaresSimilarityTransformVariant(
						[fromPoints[left], fromPoints[right]],
						[toPoints[left], toPoints[right]],
						{ reflected: false },
					)
				: solveLeastSquaresBestSimilarityTransform(
						[fromPoints[left], fromPoints[right]],
						[toPoints[left], toPoints[right]],
					);
			if (!pairFit) continue;

			const candidate = evaluateCandidateFit(
				fromPoints,
				toPoints,
				pairFit,
				threshold,
			);
			const errorSum = candidate.rmse ** 2 * candidate.inlierIndices.length;

			if (
				!bestCandidate ||
				candidate.inlierIndices.length > bestCandidate.inlierIndices.length ||
				(candidate.inlierIndices.length === bestCandidate.inlierIndices.length &&
					errorSum < bestErrorSum)
			) {
				bestCandidate = candidate;
				bestErrorSum = errorSum;
			}
		}
	}

	if (!bestCandidate || bestCandidate.inlierIndices.length < 2) {
		return null;
	}

	const refinedFit = forceNoReflection
		? solveLeastSquaresSimilarityTransformVariant(
				bestCandidate.inlierIndices.map((index) => fromPoints[index]),
				bestCandidate.inlierIndices.map((index) => toPoints[index]),
				{ reflected: false },
			)
		: solveLeastSquaresBestSimilarityTransform(
				bestCandidate.inlierIndices.map((index) => fromPoints[index]),
				bestCandidate.inlierIndices.map((index) => toPoints[index]),
			);
	if (!refinedFit) {
		return bestCandidate;
	}

	return evaluateCandidateFit(fromPoints, toPoints, refinedFit, threshold);
};

/**
 * Check if a similarity transform matrix has uniform scale (isotropic).
 * For similarity transforms, scaleX should equal scaleY.
 * @param matrix - The 6-element affine matrix [m00, m01, tx, m10, m11, ty]
 * @param tolerance - Maximum allowed ratio between scales (e.g., 1.01 = max 1% deviation)
 * @returns true if scale is uniform within tolerance
 */
export const hasUniformScale = (
	matrix: AlignmentAffineMatrix,
	tolerance = 1.01,
): boolean => {
	const scaleX = Math.hypot(matrix[0], matrix[3]);
	const scaleY = Math.hypot(matrix[1], matrix[4]);
	const minScale = Math.max(1e-10, Math.min(scaleX, scaleY));
	const maxScale = Math.max(scaleX, scaleY);
	return maxScale / minScale <= tolerance;
};

/**
 * Check if a transform matrix contains reflection (negative determinant).
 * Similarity transforms should have positive determinant (no flips).
 * @param matrix - The 6-element affine matrix [m00, m01, tx, m10, m11, ty]
 * @returns true if the matrix has positive determinant (no reflection)
 */
export const hasNoReflection = (matrix: AlignmentAffineMatrix): boolean => {
	// For 2x2 matrix [a b; c d], determinant = ad - bc
	// Matrix layout: [m00, m01, tx, m10, m11, ty]
	const m00 = matrix[0];
	const m01 = matrix[1];
	const m10 = matrix[3];
	const m11 = matrix[4];
	const determinant = m00 * m11 - m01 * m10;
	return determinant > 0;
};

/**
 * RANSAC-style robust similarity transform solver that explicitly avoids reflections.
 * Similar to solveRobustSimilarityTransform but forces reflected: false.
 * @param fromPoints - Source points
 * @param toPoints - Destination points
 * @param threshold - Inlier threshold in pixels
 * @returns CandidateFit with matrix, rmse, inliers, or null if failed
 */
export const solveRobustSimilarityTransformNoReflection = (
	fromPoints: readonly PixelPoint[],
	toPoints: readonly PixelPoint[],
	threshold: number,
): CandidateFit | null => {
	return solveRobustSimilarityTransform(fromPoints, toPoints, threshold, {
		forceNoReflection: true,
	});
};

/**
 * Solve alignment using similarity transform with strict constraints:
 * - Uniform scale only (isotropic, no anisotropic stretching)
 * - No reflections (positive determinant required)
 * - Robust to outliers via RANSAC-style pair-wise iteration
 *
 * This is the PRIMARY similarity transform solver that should replace
 * affine transform when similarity constraints are desired.
 *
 * @param fromPoints - Source control points
 * @param toPoints - Destination control points
 * @param threshold - Inlier threshold in pixels for RANSAC
 * @returns Object with matrix (null if constraints violated), inlierMask, and rmse
 */
export const solveConstrainedSimilarityTransform = (
	fromPoints: readonly PixelPoint[],
	toPoints: readonly PixelPoint[],
	threshold: number,
): { matrix: AlignmentAffineMatrix | null; inlierMask: boolean[] | null; rmse: number } => {
	// First attempt: use robust solver without reflections
	const candidate = solveRobustSimilarityTransformNoReflection(fromPoints, toPoints, threshold);

	if (!candidate) {
		return { matrix: null, inlierMask: null, rmse: Number.POSITIVE_INFINITY };
	}

	// Validate constraints
	const isUniformScale = hasUniformScale(candidate.matrix);
	const isNoReflection = hasNoReflection(candidate.matrix);

	if (!isUniformScale || !isNoReflection) {
		// Constraints violated - return null matrix but still provide diagnostics
		return {
			matrix: null,
			inlierMask: candidate.inlierMask,
			rmse: candidate.rmse,
		};
	}

	return {
		matrix: candidate.matrix,
		inlierMask: candidate.inlierMask,
		rmse: candidate.rmse,
	};
};

const getAnisotropyRatio = (matrix: AlignmentAffineMatrix | null) => {
	if (!matrix) return Number.POSITIVE_INFINITY;
	const scaleX = Math.hypot(matrix[0], matrix[3]);
	const scaleY = Math.hypot(matrix[1], matrix[4]);
	const minScale = Math.max(1e-6, Math.min(scaleX, scaleY));
	return Math.max(scaleX, scaleY) / minScale;
};

const getAverageScale = (matrix: AlignmentAffineMatrix | null) => {
	if (!matrix) return Number.NaN;
	const scaleX = Math.hypot(matrix[0], matrix[3]);
	const scaleY = Math.hypot(matrix[1], matrix[4]);
	return (scaleX + scaleY) / 2;
};

const isApproximatelySquare = (size: { width: number; height: number }) =>
	Math.abs(size.width - size.height) <= Math.max(1, 0.01 * Math.min(size.width, size.height));

const getExpectedCropScale = (
	chipBounds: PreprocessRect | null,
	referenceImageSize: { width: number; height: number },
	movingImageSize: { width: number; height: number },
) => {
	if (!chipBounds) return null;
	const scaleX = (chipBounds.width * referenceImageSize.width) / movingImageSize.width;
	const scaleY = (chipBounds.height * referenceImageSize.height) / movingImageSize.height;
	if (
		!Number.isFinite(scaleX) ||
		!Number.isFinite(scaleY) ||
		scaleX <= 0 ||
		scaleY <= 0
	) {
		return null;
	}
	return (scaleX + scaleY) / 2;
};

const getRansacThreshold = (width: number, height: number) =>
	clamp(0.003 * Math.min(width, height), 3, 12);

const readAffineData = (mat: CvMat): AlignmentAffineMatrix | null => {
	const source =
		mat.data64F?.length >= 6
			? mat.data64F
			: mat.data32F?.length >= 6
				? mat.data32F
				: null;

	if (!source) return null;

	return [source[0], source[1], source[2], source[3], source[4], source[5]];
};

type NormalizationFrame = {
	centerX: number;
	centerY: number;
	scale: number;
};

const toNormalizedFlatArray = (
	points: readonly { x: number; y: number }[],
	frame: NormalizationFrame,
) => {
	const out: number[] = [];

	for (const point of points) {
		out.push(
			(point.x - frame.centerX) / frame.scale,
			(point.y - frame.centerY) / frame.scale,
		);
	}

	return out;
};

const denormalizeAffineMatrix = (
	matrix: AlignmentAffineMatrix,
	referenceFrame: NormalizationFrame,
	movingFrame: NormalizationFrame,
): AlignmentAffineMatrix => {
	const scaleRatio = referenceFrame.scale / movingFrame.scale;
	const [a, b, tx, c, d, ty] = matrix;
	const m00 = a * scaleRatio;
	const m01 = b * scaleRatio;
	const m10 = c * scaleRatio;
	const m11 = d * scaleRatio;

	return [
		m00,
		m01,
		referenceFrame.centerX +
			tx * referenceFrame.scale -
			m00 * movingFrame.centerX -
			m01 * movingFrame.centerY,
		m10,
		m11,
		referenceFrame.centerY +
			ty * referenceFrame.scale -
			m10 * movingFrame.centerX -
			m11 * movingFrame.centerY,
	];
};

const resolveFailureReason = (
	qualityFlags: AlignmentQualityFlags,
	solveFailed: boolean,
): AlignmentFailureReason | null => {
	if (!qualityFlags.minPairs) return "insufficient-pairs";
	if (solveFailed) return "solve-failed";
	if (!qualityFlags.finiteMatrix || !qualityFlags.scaleRange)
		return "invalid-matrix";
	if (!qualityFlags.inlierRatio) return "insufficient-inliers";
	if (!qualityFlags.rmse) return "rmse-too-high";
	return null;
};

const countAcceptedInliers = (inlierMask: readonly boolean[]) =>
	inlierMask.reduce((count, isInlier) => count + (isInlier ? 1 : 0), 0);

const hasAcceptedManualInlierQuality = (
	inlierCount: number,
	inlierRatio: number,
) =>
	inlierCount >= MANUAL_MIN_INLIERS && inlierRatio >= MANUAL_MIN_INLIER_RATIO;

export type SolveAffineAlignmentInput = {
	cv: OpenCvRuntime;
	controlPoints: readonly AlignmentControlPoint[];
	chipBounds: PreprocessRect | null;
	referenceImageSize: { width: number; height: number };
	movingImageSize: { width: number; height: number };
	solveMode?: "ransac" | "allPoints" | "inlierSubset";
	forceMode?: boolean;
	seedInlierMask?: readonly boolean[] | null;
};

export type SolveAffineAlignmentOutput = {
	inlierMask: boolean[];
	affineMatrix: AlignmentAffineMatrix | null;
	reprojectionRmse: number | null;
	inlierRatio: number;
	ransacReprojThreshold: number;
	transform: AlignmentTransform | null;
	qualityFlags: AlignmentQualityFlags;
	solveAccepted: boolean;
	failureReason: AlignmentFailureReason | null;
};

export function solveAffineAlignment({
	cv,
	controlPoints,
	chipBounds,
	referenceImageSize,
	movingImageSize,
	solveMode = "ransac",
	forceMode = false,
	seedInlierMask = null,
}: SolveAffineAlignmentInput): SolveAffineAlignmentOutput {
	const effectiveSolveMode = forceMode ? "allPoints" : solveMode;
	const pointCount = controlPoints.length;
	const ransacReprojThreshold = getRansacThreshold(
		referenceImageSize.width,
		referenceImageSize.height,
	);
	const qualityFlags = defaultQualityFlags();
	qualityFlags.minPairs = pointCount >= ALIGNMENT_MIN_PAIRS;

	if (!qualityFlags.minPairs) {
		return {
			inlierMask: [],
			affineMatrix: null,
			reprojectionRmse: null,
			inlierRatio: 0,
			ransacReprojThreshold,
			transform: null,
			qualityFlags,
			solveAccepted: false,
			failureReason: "insufficient-pairs",
		};
	}

	const sourcePixels = controlPoints.map((pair) => ({
		x: pair.source.x * referenceImageSize.width,
		y: pair.source.y * referenceImageSize.height,
	}));
	const movingPixels = controlPoints.map((pair) => ({
		x: pair.target.x * movingImageSize.width,
		y: pair.target.y * movingImageSize.height,
	}));

	const referenceFrame: NormalizationFrame = {
		centerX: referenceImageSize.width / 2,
		centerY: referenceImageSize.height / 2,
		scale: Math.max(
			1,
			Math.min(referenceImageSize.width, referenceImageSize.height),
		),
	};
	const movingFrame: NormalizationFrame = {
		centerX: movingImageSize.width / 2,
		centerY: movingImageSize.height / 2,
		scale: Math.max(1, Math.min(movingImageSize.width, movingImageSize.height)),
	};

	const fromArray = toNormalizedFlatArray(movingPixels, movingFrame);
	const toArray = toNormalizedFlatArray(sourcePixels, referenceFrame);
	const normalizedThreshold = ransacReprojThreshold / referenceFrame.scale;

	let fromMat: CvMat | null = null;
	let toMat: CvMat | null = null;
	let inlierMaskMat: CvMat | null = null;

	let affineMatrix: AlignmentAffineMatrix | null = null;
	let solveFailed = false;
	let inlierMask: boolean[] = Array.from({ length: pointCount }, () => false);
	let inlierIndices: number[] = [];
	let currentCandidateRmse: number | null = null;

	try {
		if (
			typeof (cv as unknown as { setRNGSeed?: (seed: number) => void })
				.setRNGSeed === "function"
		) {
			(cv as unknown as { setRNGSeed: (seed: number) => void }).setRNGSeed(
				1337,
			);
		}

		// OpenCV matrices kept for compatibility but not used by primary similarity solver
		fromMat = cv.matFromArray(pointCount, 2, cv.CV_64F, fromArray);
		toMat = cv.matFromArray(pointCount, 2, cv.CV_64F, toArray);
		inlierMaskMat = new cv.Mat();

		if (effectiveSolveMode === "allPoints") {
			const fitted = solveLeastSquaresSimilarityTransformVariant(
				movingPixels,
				sourcePixels,
				{ reflected: false },
			);
			if (
				fitted &&
				hasUniformScale(fitted.matrix) &&
				hasNoReflection(fitted.matrix)
			) {
				affineMatrix = fitted.matrix;
				currentCandidateRmse = fitted.rmse;
				inlierMask = Array.from({ length: pointCount }, () => true);
				inlierIndices = sourcePixels.map((_, index) => index);
			} else {
				affineMatrix = null;
				solveFailed = true;
			}
		} else if (effectiveSolveMode === "inlierSubset") {
			const validSeedMask =
				seedInlierMask?.length === pointCount
					? Array.from(seedInlierMask, Boolean)
					: Array.from({ length: pointCount }, () => true);
			const seededIndices = validSeedMask
				.map((isInlier, index) => (isInlier ? index : -1))
				.filter((index) => index >= 0);
			const solveIndices = seededIndices.length >= 2
				? seededIndices
				: sourcePixels.map((_, index) => index);
			const constrainedCandidate = solveConstrainedSimilarityTransform(
				solveIndices.map((index) => movingPixels[index]),
				solveIndices.map((index) => sourcePixels[index]),
				 ransacReprojThreshold,
			);

			if (constrainedCandidate.matrix) {
				affineMatrix = constrainedCandidate.matrix;
				currentCandidateRmse = constrainedCandidate.rmse;
				inlierMask = Array.from({ length: pointCount }, (_, index) =>
					solveIndices.includes(index),
				);
				inlierIndices = solveIndices;
			} else {
				const fitted = solveLeastSquaresSimilarityTransformVariant(
					solveIndices.map((index) => movingPixels[index]),
					solveIndices.map((index) => sourcePixels[index]),
					{ reflected: false },
				);
				if (
					fitted &&
					hasUniformScale(fitted.matrix) &&
					hasNoReflection(fitted.matrix)
				) {
					affineMatrix = fitted.matrix;
					currentCandidateRmse = fitted.rmse;
					inlierMask = Array.from({ length: pointCount }, (_, index) =>
						solveIndices.includes(index),
					);
					inlierIndices = solveIndices;
				} else {
					affineMatrix = null;
					solveFailed = true;
				}
			}
		} else {
			// Use constrained similarity transform as primary solver (RANSAC mode)
			const candidate = solveConstrainedSimilarityTransform(
				movingPixels,
				sourcePixels,
				ransacReprojThreshold,
			);

			if (!candidate || !candidate.matrix) {
				// Similarity solve failed
				solveFailed = true;
				affineMatrix = null;
				inlierMask = Array.from({ length: pointCount }, () => false);
				inlierIndices = [];
			} else {
				// Extract results from constrained similarity solver
				affineMatrix = candidate.matrix;
				currentCandidateRmse = candidate.rmse;
				inlierMask = candidate.inlierMask ?? Array.from({ length: pointCount }, () => true);
				inlierIndices = inlierMask
					.map((isInlier, index) => (isInlier ? index : -1))
					.filter((index) => index >= 0);

				// Fallback: if too few inliers, use all points
				if (inlierIndices.length < 2) {
					inlierMask = Array.from({ length: pointCount }, () => true);
					inlierIndices = sourcePixels.map((_, index) => index);
				}
			}
		}

		if (isApproximatelySquare(movingImageSize)) {
			const similaritySupportIndices =
				inlierIndices.length >= 2
					? inlierIndices
					: movingPixels.map((_, index) => index);
			const expectedCropScale = getExpectedCropScale(
				chipBounds,
				referenceImageSize,
				movingImageSize,
			);
			const fixedScaleFit = expectedCropScale
				? solveBestFixedScaleSimilarityTransformNoReflection(
						similaritySupportIndices.map((index) => movingPixels[index]),
						similaritySupportIndices.map((index) => sourcePixels[index]),
						expectedCropScale,
					)
				: null;
			const similarityCandidate =
				effectiveSolveMode === "allPoints" || fixedScaleFit
				? null
				: solveRobustSimilarityTransformNoReflection(
						movingPixels,
						sourcePixels,
						ransacReprojThreshold,
					);
			const currentAverageScale = getAverageScale(affineMatrix);
			const fixedScaleFitFinite = fixedScaleFit
				? fixedScaleFit.matrix.every((value) => Number.isFinite(value))
				: false;
			const fixedScaleFitScaleX = fixedScaleFit
				? Math.hypot(fixedScaleFit.matrix[0], fixedScaleFit.matrix[3])
				: Number.NaN;
			const fixedScaleFitScaleY = fixedScaleFit
				? Math.hypot(fixedScaleFit.matrix[1], fixedScaleFit.matrix[4])
				: Number.NaN;
			const fixedScaleFitScaleRange =
				Number.isFinite(fixedScaleFitScaleX) &&
				Number.isFinite(fixedScaleFitScaleY) &&
				fixedScaleFitScaleX >= ALIGNMENT_SCALE_MIN &&
				fixedScaleFitScaleX <= ALIGNMENT_SCALE_MAX &&
				fixedScaleFitScaleY >= ALIGNMENT_SCALE_MIN &&
				fixedScaleFitScaleY <= ALIGNMENT_SCALE_MAX;
			const fixedScaleFitRmseOk = fixedScaleFit !== null &&
				fixedScaleFit.rmse <= ALIGNMENT_RMSE_MULTIPLIER * ransacReprojThreshold;
			const fixedScaleFitComparableToCurrent =
				currentCandidateRmse === null ||
				fixedScaleFit === null ||
				fixedScaleFit.rmse <= currentCandidateRmse * 1.25;
		const shouldPreferFixedScaleSimilarity =
			fixedScaleFitFinite &&
			fixedScaleFit !== null &&
			fixedScaleFitScaleRange &&
			fixedScaleFitRmseOk &&
			fixedScaleFitComparableToCurrent &&
			hasNoReflection(fixedScaleFit.matrix) &&
			(
				affineMatrix === null ||
				getAnisotropyRatio(affineMatrix) > 1.2 ||
				(expectedCropScale !== null &&
					Math.abs(currentAverageScale - expectedCropScale) >
						expectedCropScale * 0.05)
			);

			if (fixedScaleFit && shouldPreferFixedScaleSimilarity) {
				affineMatrix = fixedScaleFit.matrix;
				currentCandidateRmse = fixedScaleFit.rmse;
				solveFailed = false;
			} else if (similarityCandidate) {
				const similarityFinite = similarityCandidate.matrix.every((value) =>
					Number.isFinite(value),
				);
				const similarityScaleX = Math.hypot(
					similarityCandidate.matrix[0],
					similarityCandidate.matrix[3],
				);
				const similarityScaleY = Math.hypot(
					similarityCandidate.matrix[1],
					similarityCandidate.matrix[4],
				);
				const similarityScaleRange =
					Number.isFinite(similarityScaleX) &&
					Number.isFinite(similarityScaleY) &&
					similarityScaleX >= ALIGNMENT_SCALE_MIN &&
					similarityScaleX <= ALIGNMENT_SCALE_MAX &&
					similarityScaleY >= ALIGNMENT_SCALE_MIN &&
					similarityScaleY <= ALIGNMENT_SCALE_MAX;
				const similarityInlierRatio =
					hasAcceptedManualInlierQuality(
						similarityCandidate.inlierIndices.length,
						pointCount > 0 ? similarityCandidate.inlierIndices.length / pointCount : 0,
					);
				const similarityRmseOk =
					similarityCandidate.rmse <=
					ALIGNMENT_RMSE_MULTIPLIER * ransacReprojThreshold;
			const shouldPreferSimilarity =
				similarityFinite &&
				similarityScaleRange &&
				similarityInlierRatio &&
				similarityRmseOk &&
				hasNoReflection(similarityCandidate.matrix) &&
				(
					affineMatrix === null ||
					getAnisotropyRatio(affineMatrix) > 1.2 ||
					(expectedCropScale !== null &&
						Math.abs(currentAverageScale - expectedCropScale) >
							expectedCropScale * 0.05)
				);

				if (shouldPreferSimilarity) {
					affineMatrix = similarityCandidate.matrix;
					currentCandidateRmse = similarityCandidate.rmse;
					inlierMask = similarityCandidate.inlierMask;
					inlierIndices = similarityCandidate.inlierIndices;
					solveFailed = false;
				}
			}
		}

		const inlierCount = inlierMask.filter(Boolean).length;
		const inlierRatio = pointCount > 0 ? inlierCount / pointCount : 0;

		let reprojectionRmse: number | null = null;
		if (affineMatrix) {
			const [a, b, tx, c, d, ty] = affineMatrix;
			const indices =
				inlierIndices.length > 0
					? inlierIndices
					: sourcePixels.map((_, index) => index);

			let errorSum = 0;
			for (const index of indices) {
				const moving = movingPixels[index];
				const source = sourcePixels[index];
				const projectedX = a * moving.x + b * moving.y + tx;
				const projectedY = c * moving.x + d * moving.y + ty;
				const dx = projectedX - source.x;
				const dy = projectedY - source.y;
				errorSum += dx * dx + dy * dy;
			}

			reprojectionRmse = Math.sqrt(errorSum / Math.max(1, indices.length));
		}

		const finiteMatrix = Boolean(
			affineMatrix?.every((value) => Number.isFinite(value)),
		);
		const scaleX = affineMatrix
			? Math.hypot(affineMatrix[0], affineMatrix[3])
			: Number.NaN;
		const scaleY = affineMatrix
			? Math.hypot(affineMatrix[1], affineMatrix[4])
			: Number.NaN;
		const scaleRange =
			Number.isFinite(scaleX) &&
			Number.isFinite(scaleY) &&
			scaleX >= ALIGNMENT_SCALE_MIN &&
			scaleX <= ALIGNMENT_SCALE_MAX &&
			scaleY >= ALIGNMENT_SCALE_MIN &&
			scaleY <= ALIGNMENT_SCALE_MAX;

		qualityFlags.finiteMatrix = finiteMatrix;
		qualityFlags.scaleRange = scaleRange;
		const acceptedInlierCount = countAcceptedInliers(inlierMask);
		qualityFlags.inlierRatio = hasAcceptedManualInlierQuality(
			acceptedInlierCount,
			inlierRatio,
		);
		qualityFlags.rmse =
			reprojectionRmse !== null &&
			reprojectionRmse <= ALIGNMENT_RMSE_MULTIPLIER * ransacReprojThreshold;
		const hasSufficientCoverage = !computeCoverageWarning(
			controlPoints,
			chipBounds,
		).warning;
		qualityFlags.accepted =
			qualityFlags.minPairs &&
			qualityFlags.inlierRatio &&
			qualityFlags.rmse &&
			qualityFlags.finiteMatrix &&
			qualityFlags.scaleRange &&
			hasSufficientCoverage;

		const solveAccepted = qualityFlags.accepted;

		const failureReason = hasSufficientCoverage
			? resolveFailureReason(qualityFlags, solveFailed)
			: "insufficient-inliers";

		return {
			inlierMask,
			affineMatrix: finiteMatrix ? affineMatrix : null,
			reprojectionRmse,
			inlierRatio,
			ransacReprojThreshold,
			transform:
				finiteMatrix && affineMatrix ? deriveTransform(affineMatrix) : null,
			qualityFlags,
			solveAccepted,
			failureReason,
		};
	} finally {
		inlierMaskMat?.delete();
		fromMat?.delete();
		toMat?.delete();
	}
}

export function normalizeAlignmentSlice(slice: AlignmentSlice): AlignmentSlice {
  return {
    status: slice.status,
    isStale: slice.isStale,
    updatedAt: slice.updatedAt,
    error: slice.error,
    referenceImage: slice.referenceImage,
    movingImage: slice.movingImage,
    movingImageTransform: normalizeLocalizationImageTransform(
      slice.movingImageTransform as
        | Partial<LocalizationImageTransform>
        | null
        | undefined,
    ),
    overlayOpacity: slice.overlayOpacity,
    source: slice.source,
    controlPoints: slice.controlPoints,
    inlierMask: Array.isArray(slice.inlierMask)
      ? slice.inlierMask.map(Boolean)
      : null,
    affineMatrix:
      slice.affineMatrix && slice.affineMatrix.length === 6
        ? [
            safeNumber(slice.affineMatrix[0]),
            safeNumber(slice.affineMatrix[1]),
            safeNumber(slice.affineMatrix[2]),
            safeNumber(slice.affineMatrix[3]),
            safeNumber(slice.affineMatrix[4]),
            safeNumber(slice.affineMatrix[5]),
          ]
        : null,
    reprojectionRmse:
      typeof slice.reprojectionRmse === "number" &&
      Number.isFinite(slice.reprojectionRmse)
        ? slice.reprojectionRmse
        : null,
    inlierRatio:
      typeof slice.inlierRatio === "number" &&
      Number.isFinite(slice.inlierRatio)
        ? slice.inlierRatio
        : null,
    ransacReprojThreshold:
      typeof slice.ransacReprojThreshold === "number" &&
      Number.isFinite(slice.ransacReprojThreshold)
        ? slice.ransacReprojThreshold
        : null,
    qualityFlags: {
      ...defaultQualityFlags(),
      ...(slice.qualityFlags ?? {}),
      accepted: Boolean(slice.qualityFlags?.accepted),
    },
    solveAccepted: Boolean(slice.solveAccepted),
    failureReason: slice.failureReason ?? null,
    transform: slice.transform,
    previewDataUrl: slice.previewDataUrl,
  };
}

export function computeAlignmentStatus(args: {
	hasReferenceImage: boolean;
	hasMovingImage: boolean;
	solveAccepted: boolean;
	failureReason: AlignmentFailureReason | null;
}): PreprocessStepStatus {
	if (!args.hasReferenceImage || !args.hasMovingImage) return "idle";
	if (args.solveAccepted) return "complete";
	if (args.failureReason) return "error";
	return "ready";
}
