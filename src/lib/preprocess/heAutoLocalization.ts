import type {
  AlignmentAffineMatrix,
  AlignmentTransform,
  HeFocusAutoProposalQuad,
  PreprocessPoint,
  PreprocessRect,
} from '@/types/preprocess';
import { loadOpenCv, type CvMat, type OpenCvRuntime } from './loadOpenCv';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const DEFAULT_COARSE_SEARCH_HEIGHT = 876;
const DEFAULT_ECC_CANVAS_SIZE = 900;
const DEFAULT_COARSE_SCORE_THRESHOLD = 0.15;
export const HE_AUTO_LOCALIZATION_METHOD = 'mask-ecc-v1';
export const HE_AUTO_LOCALIZATION_ECC_MIN = 0.75;

const ASYMMETRIC_PADDING_VARIANTS = [0.12, 0.18, 0.24].flatMap((top) => [0.0, 0.06, 0.12].flatMap((bottom) =>
  [0.12, 0.18, 0.24].flatMap((left) => [0.12, 0.18, 0.24].map((right) => [top, bottom, left, right] as const))));

const ASYMMETRIC_SCALE_VALUES = Array.from({ length: 33 }, (_, index) => 0.66 + index * 0.0025);

type GrayImage = {
  width: number;
  height: number;
  data: Float32Array;
};

type BinaryImage = {
  width: number;
  height: number;
  data: Uint8Array;
};

type LoadedImageData = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

type HeAutoLocalizationImageSource = {
  imageData?: ImageData;
  dataUrl?: string;
};

type HeAutoLocalizationAcceptedTransform = {
  affineMatrix: AlignmentAffineMatrix;
  transform: AlignmentTransform;
};

export type HeAutoLocalizationFailureReason =
  | 'missing-localization-bounds'
  | 'query-decode-failed'
  | 'he-decode-failed'
  | 'runtime-missing-capabilities'
  | 'insufficient-query-signal'
  | 'insufficient-he-signal'
  | 'no-coarse-match'
  | 'ecc-failed'
  | 'ecc-below-threshold';

export type HeAutoLocalizationResult = {
  method: typeof HE_AUTO_LOCALIZATION_METHOD;
  coarseBounds: PreprocessRect | null;
  refinedBounds: PreprocessRect | null;
  refinedQuad: HeFocusAutoProposalQuad | null;
  rotationDegrees: number | null;
  eccCorrelation: number | null;
  acceptedTransform: HeAutoLocalizationAcceptedTransform | null;
  failureReason: HeAutoLocalizationFailureReason | null;
};

export type RunHeAutoLocalizationInput = {
  eosinSource: HeAutoLocalizationImageSource;
  heSource: HeAutoLocalizationImageSource;
  localizationBounds: PreprocessRect | null;
  cv?: OpenCvRuntime;
  queryMaskSize?: number;
  coarseSearchHeight?: number;
  eccCanvasSize?: number;
  coarseScoreThreshold?: number;
  eccAcceptanceThreshold?: number;
};

type OpenCvPoint = { x: number; y: number };

type MatchTemplateRuntime = OpenCvRuntime & {
  CV_32F: number;
  TM_CCOEFF_NORMED: number;
  MOTION_EUCLIDEAN: number;
  TERM_CRITERIA_EPS: number;
  TERM_CRITERIA_COUNT: number;
  matchTemplate: (image: CvMat, templ: CvMat, result: CvMat, method: number) => void;
  minMaxLoc: (src: CvMat) => {
    minVal: number;
    maxVal: number;
    minLoc: OpenCvPoint;
    maxLoc: OpenCvPoint;
  };
  findTransformECC: (
    templateImage: CvMat,
    inputImage: CvMat,
    warpMatrix: CvMat,
    motionType: number,
    criteria: { type: number; maxCount: number; epsilon: number },
    inputMask?: CvMat,
    gaussFiltSize?: number,
  ) => number;
};

type SearchCandidate = {
  score: number;
  rotationDegrees: 0 | 90 | 180 | 270;
  paddingRatios: readonly [number, number, number, number];
  scale: number;
  location: OpenCvPoint;
  templateWidth: number;
  templateHeight: number;
};

const isMatchTemplateRuntime = (cv: OpenCvRuntime): cv is MatchTemplateRuntime => {
  const candidate = cv as Partial<MatchTemplateRuntime>;
  return typeof candidate.matchTemplate === 'function'
    && typeof candidate.minMaxLoc === 'function'
    && typeof candidate.findTransformECC === 'function'
    && typeof candidate.CV_32F === 'number'
    && typeof candidate.TM_CCOEFF_NORMED === 'number'
    && typeof candidate.MOTION_EUCLIDEAN === 'number'
    && typeof candidate.TERM_CRITERIA_EPS === 'number'
    && typeof candidate.TERM_CRITERIA_COUNT === 'number';
};

const loadImageElement = (dataUrl: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new window.Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Image decoding failed'));
  image.src = dataUrl;
});

const loadSourceImageData = async (
  source: HeAutoLocalizationImageSource,
  decodeFailureReason: HeAutoLocalizationFailureReason,
): Promise<LoadedImageData> => {
  if (source.imageData) {
    return {
      width: source.imageData.width,
      height: source.imageData.height,
      data: new Uint8ClampedArray(source.imageData.data),
    };
  }

  if (!source.dataUrl) {
    throw new Error(decodeFailureReason);
  }

  if (typeof document === 'undefined' || typeof window === 'undefined') {
    throw new Error(decodeFailureReason);
  }

  try {
    const image = await loadImageElement(source.dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(decodeFailureReason);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    return {
      width: imageData.width,
      height: imageData.height,
      data: new Uint8ClampedArray(imageData.data),
    };
  } catch {
    throw new Error(decodeFailureReason);
  }
};

const rectToPixelRect = (rect: PreprocessRect, size: { width: number; height: number }) => {
  const x0 = clamp(rect.x, 0, 1);
  const y0 = clamp(rect.y, 0, 1);
  const x1 = clamp(rect.x + rect.width, 0, 1);
  const y1 = clamp(rect.y + rect.height, 0, 1);
  const pxX = clamp(Math.round(x0 * size.width), 0, Math.max(0, size.width - 1));
  const pxY = clamp(Math.round(y0 * size.height), 0, Math.max(0, size.height - 1));
  const pxWidth = Math.max(1, Math.round((x1 - x0) * size.width));
  const pxHeight = Math.max(1, Math.round((y1 - y0) * size.height));

  return {
    x: pxX,
    y: pxY,
    width: Math.min(pxWidth, size.width - pxX),
    height: Math.min(pxHeight, size.height - pxY),
  };
};

const cropImageData = (source: LoadedImageData, rect: { x: number; y: number; width: number; height: number }): LoadedImageData => {
  const output = new Uint8ClampedArray(rect.width * rect.height * 4);

  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const sourceIndex = ((rect.y + y) * source.width + (rect.x + x)) * 4;
      const targetIndex = (y * rect.width + x) * 4;
      output[targetIndex] = source.data[sourceIndex];
      output[targetIndex + 1] = source.data[sourceIndex + 1];
      output[targetIndex + 2] = source.data[sourceIndex + 2];
      output[targetIndex + 3] = source.data[sourceIndex + 3];
    }
  }

  return {
    width: rect.width,
    height: rect.height,
    data: output,
  };
};

const rgbaToGrayscale = (source: LoadedImageData): GrayImage => {
  const data = new Float32Array(source.width * source.height);
  for (let index = 0; index < data.length; index += 1) {
    const offset = index * 4;
    data[index] = source.data[offset] * 0.299 + source.data[offset + 1] * 0.587 + source.data[offset + 2] * 0.114;
  }
  return { width: source.width, height: source.height, data };
};

const sampleGrayBilinear = (image: GrayImage, x: number, y: number) => {
  const clampedX = clamp(x, 0, image.width - 1);
  const clampedY = clamp(y, 0, image.height - 1);
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const dx = clampedX - x0;
  const dy = clampedY - y0;
  const topLeft = image.data[y0 * image.width + x0];
  const topRight = image.data[y0 * image.width + x1];
  const bottomLeft = image.data[y1 * image.width + x0];
  const bottomRight = image.data[y1 * image.width + x1];
  const top = topLeft * (1 - dx) + topRight * dx;
  const bottom = bottomLeft * (1 - dx) + bottomRight * dx;
  return top * (1 - dy) + bottom * dy;
};

const resizeGrayImage = (image: GrayImage, width: number, height: number): GrayImage => {
  if (width === image.width && height === image.height) {
    return { width, height, data: new Float32Array(image.data) };
  }

  const data = new Float32Array(width * height);
  const scaleX = image.width / width;
  const scaleY = image.height / height;

  for (let y = 0; y < height; y += 1) {
    const sourceY = (y + 0.5) * scaleY - 0.5;
    for (let x = 0; x < width; x += 1) {
      const sourceX = (x + 0.5) * scaleX - 0.5;
      data[y * width + x] = sampleGrayBilinear(image, sourceX, sourceY);
    }
  }

  return { width, height, data };
};

const gaussianKernel = (sigma: number) => {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);
  let total = 0;
  for (let index = 0; index < size; index += 1) {
    const distance = index - radius;
    const value = Math.exp(-(distance * distance) / (2 * sigma * sigma));
    kernel[index] = value;
    total += value;
  }
  for (let index = 0; index < size; index += 1) {
    kernel[index] /= total;
  }
  return { kernel, radius };
};

const blurGrayImage = (image: GrayImage, sigma: number): GrayImage => {
  const { kernel, radius } = gaussianKernel(sigma);
  const horizontal = new Float32Array(image.width * image.height);
  const output = new Float32Array(image.width * image.height);

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleX = clamp(x + offset, 0, image.width - 1);
        sum += image.data[y * image.width + sampleX] * kernel[offset + radius];
      }
      horizontal[y * image.width + x] = sum;
    }
  }

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleY = clamp(y + offset, 0, image.height - 1);
        sum += horizontal[sampleY * image.width + x] * kernel[offset + radius];
      }
      output[y * image.width + x] = sum;
    }
  }

  return { width: image.width, height: image.height, data: output };
};

const computeOtsuThreshold = (gray: GrayImage) => {
  const histogram = new Uint32Array(256);
  for (let index = 0; index < gray.data.length; index += 1) {
    histogram[clamp(Math.round(gray.data[index]), 0, 255)] += 1;
  }

  const total = gray.data.length;
  let sum = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    sum += index * histogram[index];
  }

  let sumBackground = 0;
  let weightBackground = 0;
  let maxVariance = -1;
  let threshold = 0;

  for (let index = 0; index < histogram.length; index += 1) {
    weightBackground += histogram[index];
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += index * histogram[index];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = index;
    }
  }

  return threshold;
};

const thresholdInverseOtsu = (gray: GrayImage): BinaryImage => {
  const threshold = computeOtsuThreshold(gray);
  const data = new Uint8Array(gray.width * gray.height);
  for (let index = 0; index < gray.data.length; index += 1) {
    data[index] = gray.data[index] <= threshold ? 255 : 0;
  }
  return { width: gray.width, height: gray.height, data };
};

const erodeBinaryImage = (image: BinaryImage, kernelSize: number): BinaryImage => {
  const radius = Math.floor(kernelSize / 2);
  const output = new Uint8Array(image.width * image.height);

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      let keep = 255;
      for (let ky = -radius; ky <= radius && keep === 255; ky += 1) {
        const sampleY = clamp(y + ky, 0, image.height - 1);
        for (let kx = -radius; kx <= radius; kx += 1) {
          const sampleX = clamp(x + kx, 0, image.width - 1);
          if (image.data[sampleY * image.width + sampleX] === 0) {
            keep = 0;
            break;
          }
        }
      }
      output[y * image.width + x] = keep;
    }
  }

  return { width: image.width, height: image.height, data: output };
};

const dilateBinaryImage = (image: BinaryImage, kernelSize: number): BinaryImage => {
  const radius = Math.floor(kernelSize / 2);
  const output = new Uint8Array(image.width * image.height);

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      let value = 0;
      for (let ky = -radius; ky <= radius && value === 0; ky += 1) {
        const sampleY = clamp(y + ky, 0, image.height - 1);
        for (let kx = -radius; kx <= radius; kx += 1) {
          const sampleX = clamp(x + kx, 0, image.width - 1);
          if (image.data[sampleY * image.width + sampleX] > 0) {
            value = 255;
            break;
          }
        }
      }
      output[y * image.width + x] = value;
    }
  }

  return { width: image.width, height: image.height, data: output };
};

const openBinaryImage = (image: BinaryImage, kernelSize: number) => dilateBinaryImage(erodeBinaryImage(image, kernelSize), kernelSize);

const closeBinaryImage = (image: BinaryImage, kernelSize: number) => erodeBinaryImage(dilateBinaryImage(image, kernelSize), kernelSize);

const buildTissueMask = (source: LoadedImageData): BinaryImage => {
  const gray = rgbaToGrayscale(source);
  const blurred = blurGrayImage(gray, 1.2);
  const thresholded = thresholdInverseOtsu(blurred);
  return closeBinaryImage(openBinaryImage(thresholded, 3), 7);
};

const resizeBinaryNearest = (image: BinaryImage, width: number, height: number): BinaryImage => {
  const data = new Uint8Array(width * height);
  const scaleX = image.width / width;
  const scaleY = image.height / height;

  for (let y = 0; y < height; y += 1) {
    const sourceY = clamp(Math.round((y + 0.5) * scaleY - 0.5), 0, image.height - 1);
    for (let x = 0; x < width; x += 1) {
      const sourceX = clamp(Math.round((x + 0.5) * scaleX - 0.5), 0, image.width - 1);
      data[y * width + x] = image.data[sourceY * image.width + sourceX];
    }
  }

  return { width, height, data };
};

const rotateBinaryImage90 = (image: BinaryImage, degrees: 0 | 90 | 180 | 270): BinaryImage => {
  if (degrees === 0) return { width: image.width, height: image.height, data: new Uint8Array(image.data) };
  if (degrees === 180) {
    const data = new Uint8Array(image.width * image.height);
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const sourceIndex = y * image.width + x;
        const targetIndex = (image.height - 1 - y) * image.width + (image.width - 1 - x);
        data[targetIndex] = image.data[sourceIndex];
      }
    }
    return { width: image.width, height: image.height, data };
  }

  const width = image.height;
  const height = image.width;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const sourceValue = image.data[y * image.width + x];
      if (degrees === 90) {
        const targetX = image.height - 1 - y;
        const targetY = x;
        data[targetY * width + targetX] = sourceValue;
      } else {
        const targetX = y;
        const targetY = image.width - 1 - x;
        data[targetY * width + targetX] = sourceValue;
      }
    }
  }
  return { width, height, data };
};

const padBinaryImage = (
  image: BinaryImage,
  topRatio: number,
  bottomRatio: number,
  leftRatio: number,
  rightRatio: number,
): BinaryImage => {
  const top = Math.round(image.height * topRatio);
  const bottom = Math.round(image.height * bottomRatio);
  const left = Math.round(image.width * leftRatio);
  const right = Math.round(image.width * rightRatio);
  const width = image.width + left + right;
  const height = image.height + top + bottom;
  const data = new Uint8Array(width * height);

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      data[(y + top) * width + (x + left)] = image.data[y * image.width + x];
    }
  }

  return { width, height, data };
};

const resizeMaskForEcc = (mask: BinaryImage, canvasSize: number): GrayImage => {
  const gray = {
    width: mask.width,
    height: mask.height,
    data: Float32Array.from(mask.data),
  } satisfies GrayImage;
  const resized = resizeGrayImage(gray, canvasSize, canvasSize);
  const blurred = blurGrayImage(resized, 1.0);
  const normalized = new Float32Array(blurred.data.length);
  for (let index = 0; index < blurred.data.length; index += 1) {
    normalized[index] = blurred.data[index] / 255;
  }
  return {
    width: canvasSize,
    height: canvasSize,
    data: normalized,
  };
};

const countMaskCoverage = (mask: BinaryImage) => {
  let active = 0;
  for (let index = 0; index < mask.data.length; index += 1) {
    if (mask.data[index] > 0) active += 1;
  }
  return active / Math.max(1, mask.data.length);
};

const toCvFloatMat = (cv: MatchTemplateRuntime, image: GrayImage | BinaryImage) => {
  const values = image.data instanceof Float32Array
    ? image.data
    : Float32Array.from(image.data, (value) => value / 255);
  return cv.matFromArray(image.height, image.width, cv.CV_32F, values);
};

const releaseCvMat = (mat: CvMat | null | undefined) => {
  if (mat && typeof mat.delete === 'function') {
    mat.delete();
  }
};

const searchTemplateVariants = (args: {
  cv: MatchTemplateRuntime;
  heMask: BinaryImage;
  queryMask: BinaryImage;
  coarseScoreThreshold: number;
}): SearchCandidate | null => {
  const heMat = toCvFloatMat(args.cv, args.heMask);
  let bestCandidate: SearchCandidate | null = null;

  try {
    const rotatedTemplates = {
      0: args.queryMask,
      90: rotateBinaryImage90(args.queryMask, 90),
      180: rotateBinaryImage90(args.queryMask, 180),
      270: rotateBinaryImage90(args.queryMask, 270),
    } as const;

    const rotationKeys = [0, 90, 180, 270] as const;
    for (const rotationKey of rotationKeys) {
      const rotated = rotatedTemplates[rotationKey];
      for (const paddingRatios of ASYMMETRIC_PADDING_VARIANTS) {
        const padded = padBinaryImage(rotated, ...paddingRatios);
        for (const scale of ASYMMETRIC_SCALE_VALUES) {
          const templateWidth = Math.max(32, Math.round(padded.width * scale));
          const templateHeight = Math.max(32, Math.round(padded.height * scale));
          if (templateWidth >= args.heMask.width || templateHeight >= args.heMask.height) {
            continue;
          }

          const template = resizeBinaryNearest(padded, templateWidth, templateHeight);
          const templateCoverage = countMaskCoverage(template);
          if (templateCoverage <= 0.005) {
            continue;
          }

          const templateMat = toCvFloatMat(args.cv, template);
          const responseMat = new args.cv.Mat();

          try {
            args.cv.matchTemplate(heMat, templateMat, responseMat, args.cv.TM_CCOEFF_NORMED);
            const { maxVal, maxLoc } = args.cv.minMaxLoc(responseMat);
            if (!Number.isFinite(maxVal)) continue;
            if (!bestCandidate || maxVal > bestCandidate.score) {
              bestCandidate = {
                score: maxVal,
                rotationDegrees: Number(rotationKey) as SearchCandidate['rotationDegrees'],
                paddingRatios,
                scale,
                location: maxLoc,
                templateWidth,
                templateHeight,
              };
            }
          } finally {
            releaseCvMat(responseMat);
            releaseCvMat(templateMat);
          }
        }
      }
    }
  } finally {
    releaseCvMat(heMat);
  }

  if (!bestCandidate || bestCandidate.score < args.coarseScoreThreshold) {
    return null;
  }

  return bestCandidate;
};

const toNormalizedRect = (rect: { x: number; y: number; width: number; height: number }, size: { width: number; height: number }): PreprocessRect => ({
  x: clamp(rect.x / size.width, 0, 1),
  y: clamp(rect.y / size.height, 0, 1),
  width: clamp(rect.width / size.width, 0, 1),
  height: clamp(rect.height / size.height, 0, 1),
});

const toNormalizedPoint = (point: { x: number; y: number }, size: { width: number; height: number }): PreprocessPoint => ({
  x: clamp(point.x / size.width, 0, 1),
  y: clamp(point.y / size.height, 0, 1),
});

const quadToRect = (quad: readonly { x: number; y: number }[]) => {
  const xs = quad.map((point) => point.x);
  const ys = quad.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

const solveLinearSystem = (matrix: number[][], vector: number[]) => {
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
      const temporary = augmented[pivot];
      augmented[pivot] = augmented[bestRow];
      augmented[bestRow] = temporary;
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

const solveSimilarityTransform = (
  fromPoints: readonly { x: number; y: number }[],
  toPoints: readonly { x: number; y: number }[],
): AlignmentAffineMatrix | null => {
  if (fromPoints.length !== toPoints.length || fromPoints.length < 2) {
    return null;
  }

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
    accumulate([from.x, -from.y, 1, 0], to.x);
    accumulate([from.y, from.x, 0, 1], to.y);
  }

  const solution = solveLinearSystem(ata, atb);
  if (!solution) return null;

  const [a, b, tx, ty] = solution;
  return [a, -b, tx, b, a, ty];
};

const deriveAlignmentTransform = (matrix: AlignmentAffineMatrix): AlignmentTransform => {
  const [a, b, tx, c, d, ty] = matrix;
  const scaleX = Math.hypot(a, c);
  const scaleY = Math.hypot(b, d);
  return {
    translationX: tx,
    translationY: ty,
    rotationDegrees: Math.atan2(c, a) * (180 / Math.PI),
    scaleX,
    scaleY,
    isUniformScale: Math.abs(scaleX - scaleY) < 0.01 * Math.max(scaleX, scaleY, 1e-6),
  };
};

const readWarpMatrix = (warpMatrix: CvMat): AlignmentAffineMatrix | null => {
  const values = warpMatrix.data32F.length >= 6
    ? Array.from(warpMatrix.data32F.slice(0, 6))
    : Array.from(warpMatrix.data64F.slice(0, 6));

  if (values.length < 6 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  return [values[0], values[1], values[2], values[3], values[4], values[5]];
};

const applyAffineToPoint = (point: { x: number; y: number }, matrix: AlignmentAffineMatrix) => ({
  x: matrix[0] * point.x + matrix[1] * point.y + matrix[2],
  y: matrix[3] * point.x + matrix[4] * point.y + matrix[5],
});

const getQueryCorners = (rect: { x: number; y: number; width: number; height: number }) => ([
  { x: rect.x, y: rect.y },
  { x: rect.x + rect.width, y: rect.y },
  { x: rect.x + rect.width, y: rect.y + rect.height },
  { x: rect.x, y: rect.y + rect.height },
] as const);

const buildAcceptedTransform = (args: {
  refinedQuadPixels: readonly { x: number; y: number }[];
  eosinQueryPixelRect: { x: number; y: number; width: number; height: number };
}): HeAutoLocalizationAcceptedTransform | null => {
  const affineMatrix = solveSimilarityTransform(args.refinedQuadPixels, getQueryCorners(args.eosinQueryPixelRect));
  if (!affineMatrix) return null;
  return {
    affineMatrix,
    transform: deriveAlignmentTransform(affineMatrix),
  };
};

const projectRefinedChipQuad = (args: {
  coarseRect: { x: number; y: number; width: number; height: number };
  warpMatrix: AlignmentAffineMatrix;
  queryMask: BinaryImage;
  paddingRatios: readonly [number, number, number, number];
  canvasSize: number;
}) => {
  const [top, bottom, left, right] = args.paddingRatios;
  const paddedWidth = args.queryMask.width * (1 + left + right);
  const paddedHeight = args.queryMask.height * (1 + top + bottom);
  const chipRectInPadded = {
    x: args.queryMask.width * left,
    y: args.queryMask.height * top,
    width: args.queryMask.width,
    height: args.queryMask.height,
  };
  const corners = getQueryCorners(chipRectInPadded).map((point) => ({
    x: point.x / paddedWidth * args.canvasSize,
    y: point.y / paddedHeight * args.canvasSize,
  }));

  return corners.map((corner) => {
    const projected = applyAffineToPoint(corner, args.warpMatrix);
    return {
      x: args.coarseRect.x + (projected.x / args.canvasSize) * args.coarseRect.width,
      y: args.coarseRect.y + (projected.y / args.canvasSize) * args.coarseRect.height,
    };
  });
};

const createFailureResult = (
  failureReason: HeAutoLocalizationFailureReason,
  coarseBounds: PreprocessRect | null = null,
): HeAutoLocalizationResult => ({
  method: HE_AUTO_LOCALIZATION_METHOD,
  coarseBounds,
  refinedBounds: null,
  refinedQuad: null,
  rotationDegrees: null,
  eccCorrelation: null,
  acceptedTransform: null,
  failureReason,
});

export async function runHeAutoLocalization(input: RunHeAutoLocalizationInput): Promise<HeAutoLocalizationResult> {
  if (!input.localizationBounds) {
    return createFailureResult('missing-localization-bounds');
  }

  const eosinImage = await loadSourceImageData(input.eosinSource, 'query-decode-failed').catch(() => null);
  if (!eosinImage) {
    return createFailureResult('query-decode-failed');
  }

  const heImage = await loadSourceImageData(input.heSource, 'he-decode-failed').catch(() => null);
  if (!heImage) {
    return createFailureResult('he-decode-failed');
  }

  const eosinQueryPixelRect = rectToPixelRect(input.localizationBounds, eosinImage);
  const eosinQuery = cropImageData(eosinImage, eosinQueryPixelRect);
  const queryMaskSize = Math.max(64, Math.round(input.queryMaskSize ?? 512));
  const queryMask = buildTissueMask(resizeBinarySource(eosinQuery, queryMaskSize, queryMaskSize));
  const heSearchHeight = Math.max(64, Math.round(input.coarseSearchHeight ?? DEFAULT_COARSE_SEARCH_HEIGHT));
  const heSearchWidth = Math.max(64, Math.round(heImage.width * heSearchHeight / heImage.height));
  const heMask = buildTissueMask(resizeBinarySource(heImage, heSearchWidth, heSearchHeight));

  const queryCoverage = countMaskCoverage(queryMask);
  if (queryCoverage <= 0.005) {
    return createFailureResult('insufficient-query-signal');
  }

  const heCoverage = countMaskCoverage(heMask);
  if (heCoverage <= 0.005) {
    return createFailureResult('insufficient-he-signal');
  }

  const cvRuntime = input.cv ?? (await loadOpenCv()).cv;
  if (!isMatchTemplateRuntime(cvRuntime)) {
    return createFailureResult('runtime-missing-capabilities');
  }

  const coarseCandidate = searchTemplateVariants({
    cv: cvRuntime,
    heMask,
    queryMask,
    coarseScoreThreshold: input.coarseScoreThreshold ?? DEFAULT_COARSE_SCORE_THRESHOLD,
  });

  if (!coarseCandidate) {
    return createFailureResult('no-coarse-match');
  }

  const coarsePixelRect = {
    x: Math.round(coarseCandidate.location.x * heImage.width / heSearchWidth),
    y: Math.round(coarseCandidate.location.y * heImage.height / heSearchHeight),
    width: Math.round(coarseCandidate.templateWidth * heImage.width / heSearchWidth),
    height: Math.round(coarseCandidate.templateHeight * heImage.height / heSearchHeight),
  };

  const normalizedCoarseBounds = toNormalizedRect(coarsePixelRect, heImage);
  const safeCoarseRect = rectToPixelRect(normalizedCoarseBounds, heImage);
  const coarsePatch = cropImageData(heImage, safeCoarseRect);
  const coarsePatchMask = buildTissueMask(coarsePatch);
  const paddedQueryMask = padBinaryImage(queryMask, ...coarseCandidate.paddingRatios);
  const queryEcc = resizeMaskForEcc(paddedQueryMask, input.eccCanvasSize ?? DEFAULT_ECC_CANVAS_SIZE);
  const coarseEcc = resizeMaskForEcc(coarsePatchMask, input.eccCanvasSize ?? DEFAULT_ECC_CANVAS_SIZE);

  let queryMat: CvMat | null = null;
  let coarseMat: CvMat | null = null;
  let warpMat: CvMat | null = null;
  let fullMaskMat: CvMat | null = null;

  try {
    queryMat = toCvFloatMat(cvRuntime, queryEcc);
    coarseMat = toCvFloatMat(cvRuntime, coarseEcc);
    warpMat = cvRuntime.matFromArray(2, 3, cvRuntime.CV_32F, Float32Array.from([1, 0, 0, 0, 1, 0]));
    fullMaskMat = cvRuntime.matFromArray(queryEcc.height, queryEcc.width, cvRuntime.CV_32F, Float32Array.from({ length: queryEcc.width * queryEcc.height }, () => 1));

    const eccCorrelation = cvRuntime.findTransformECC(
      queryMat,
      coarseMat,
      warpMat,
      cvRuntime.MOTION_EUCLIDEAN,
      {
        type: cvRuntime.TERM_CRITERIA_EPS | cvRuntime.TERM_CRITERIA_COUNT,
        maxCount: 500,
        epsilon: 1e-6,
      },
      fullMaskMat,
      5,
    );

    const warpMatrix = readWarpMatrix(warpMat);
    if (!warpMatrix || !Number.isFinite(eccCorrelation)) {
      return createFailureResult('ecc-failed', normalizedCoarseBounds);
    }

    const refinedQuadPixels = projectRefinedChipQuad({
      coarseRect: safeCoarseRect,
      warpMatrix,
      queryMask,
      paddingRatios: coarseCandidate.paddingRatios,
      canvasSize: queryEcc.width,
    });
    const refinedBounds = toNormalizedRect(quadToRect(refinedQuadPixels), heImage);
    const refinedQuad = refinedQuadPixels.map((point) => toNormalizedPoint(point, heImage)) as HeFocusAutoProposalQuad;
    const rotationDegrees = Math.atan2(warpMatrix[3], warpMatrix[0]) * (180 / Math.PI);
    const acceptedTransform = buildAcceptedTransform({
      refinedQuadPixels,
      eosinQueryPixelRect,
    });
    const acceptanceThreshold = input.eccAcceptanceThreshold ?? HE_AUTO_LOCALIZATION_ECC_MIN;

    return {
      method: HE_AUTO_LOCALIZATION_METHOD,
      coarseBounds: normalizedCoarseBounds,
      refinedBounds,
      refinedQuad,
      rotationDegrees,
      eccCorrelation,
      acceptedTransform: eccCorrelation >= acceptanceThreshold ? acceptedTransform : null,
      failureReason: eccCorrelation >= acceptanceThreshold ? null : 'ecc-below-threshold',
    };
  } catch {
    return createFailureResult('ecc-failed', normalizedCoarseBounds);
  } finally {
    releaseCvMat(queryMat);
    releaseCvMat(coarseMat);
    releaseCvMat(warpMat);
    releaseCvMat(fullMaskMat);
  }
}

function resizeBinarySource(source: LoadedImageData, width: number, height: number): LoadedImageData {
  const gray = rgbaToGrayscale(source);
  const resized = resizeGrayImage(gray, width, height);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < resized.data.length; index += 1) {
    const value = clamp(Math.round(resized.data[index]), 0, 255);
    const offset = index * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return { width, height, data };
}
