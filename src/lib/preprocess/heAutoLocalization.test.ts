import { open, type FileHandle } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import type { PreprocessRect } from '@/types/preprocess';

import {
  HE_AUTO_LOCALIZATION_METHOD,
  runHeAutoLocalization,
} from './heAutoLocalization';
import type { CvMat, OpenCvRuntime } from './loadOpenCv';

class FakeMat implements CvMat {
  rows: number;
  cols: number;
  data64F: Float64Array;
  data32F: Float32Array;
  data: Uint8Array;

  constructor(...args: unknown[]) {
    const [rowsArg = 0, colsArg = 0, _typeArg = 0, valuesArg = []] = args;
    const values = typeof valuesArg === 'object' && valuesArg !== null && 'length' in valuesArg
      ? Array.from(valuesArg as ArrayLike<number>)
      : [];

    this.rows = typeof rowsArg === 'number' ? rowsArg : 0;
    this.cols = typeof colsArg === 'number' ? colsArg : 0;
    this.data64F = Float64Array.from(values);
    this.data32F = Float32Array.from(values);
    this.data = Uint8Array.from(values.map((value) => Math.max(0, Math.min(255, Math.round(value * 255)))));
  }

  empty() {
    return this.rows === 0 || this.cols === 0;
  }

  delete() {
    return;
  }
}

class MockImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

const VALIDATED_SAMPLE_ZIP_PATH = '/home/gaox/spatial-choosen/ref/ref.zip';
const VALIDATED_SAMPLE_EOSIN_ENTRY = 'source-assets/eosin';
const VALIDATED_SAMPLE_HE_ENTRY = 'source-assets/he';
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const MAX_ZIP_COMMENT_LENGTH = 0xffff;
const VALIDATED_SAMPLE_LOCALIZATION_BOUNDS: PreprocessRect = {
  x: 0.0732639890147615,
  y: 0.04820984410579787,
  width: 0.8722718846549947,
  height: 0.741790155894202,
};
const VALIDATED_SAMPLE_HE_FOCUS_BOUNDS: PreprocessRect = {
  x: 0.4392751736111111,
  y: 0.0120325203252033,
  width: 0.48685908564814817,
  height: 0.5699813685636856,
};

type PixelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ZipStoredEntry = {
  dataOffset: number;
  uncompressedSize: number;
};

type BmpMetadata = {
  bitsPerPixel: 24 | 32;
  height: number;
  pixelArrayOffset: number;
  rowStride: number;
  topDown: boolean;
  width: number;
};

type ValidatedRegressionFixture = {
  eosin: ImageData;
  he: ImageData;
  localizationBounds: PreprocessRect;
};

let validatedRegressionFixturePromise: Promise<ValidatedRegressionFixture> | null = null;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const readExactly = async (file: FileHandle, length: number, position: number) => {
  const buffer = Buffer.alloc(length);
  let offset = 0;

  while (offset < length) {
    const { bytesRead } = await file.read(buffer, offset, length - offset, position + offset);
    if (bytesRead === 0) {
      throw new Error('Unexpected EOF while reading validated regression fixture.');
    }
    offset += bytesRead;
  }

  return buffer;
};

const readStoredZipEntries = async (file: FileHandle) => {
  const fileSize = (await file.stat()).size;
  const tailLength = Math.min(fileSize, MAX_ZIP_COMMENT_LENGTH + 22);
  const tailStart = fileSize - tailLength;
  const tail = await readExactly(file, tailLength, tailStart);
  let eocdIndex = -1;

  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (tail.readUInt32LE(index) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      eocdIndex = index;
      break;
    }
  }

  if (eocdIndex < 0) {
    throw new Error('Validated regression fixture ZIP is missing an end-of-central-directory record.');
  }

  const centralDirectorySize = tail.readUInt32LE(eocdIndex + 12);
  const centralDirectoryOffset = tail.readUInt32LE(eocdIndex + 16);
  const centralDirectory = await readExactly(file, centralDirectorySize, centralDirectoryOffset);
  const entries = new Map<string, ZipStoredEntry>();
  let offset = 0;

  while (offset + 46 <= centralDirectory.length) {
    if (centralDirectory.readUInt32LE(offset) !== CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE) {
      throw new Error('Validated regression fixture ZIP has an invalid central directory entry.');
    }

    const compressionMethod = centralDirectory.readUInt16LE(offset + 10);
    const uncompressedSize = centralDirectory.readUInt32LE(offset + 24);
    const fileNameLength = centralDirectory.readUInt16LE(offset + 28);
    const extraFieldLength = centralDirectory.readUInt16LE(offset + 30);
    const fileCommentLength = centralDirectory.readUInt16LE(offset + 32);
    const localHeaderOffset = centralDirectory.readUInt32LE(offset + 42);
    const fileName = centralDirectory.toString('utf8', offset + 46, offset + 46 + fileNameLength);

    if (compressionMethod !== 0) {
      throw new Error(`Validated regression fixture entry ${fileName} is compressed; the test only supports stored entries.`);
    }

    const localHeader = await readExactly(file, 30, localHeaderOffset);
    if (localHeader.readUInt32LE(0) !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new Error(`Validated regression fixture entry ${fileName} has an invalid local header.`);
    }

    const localFileNameLength = localHeader.readUInt16LE(26);
    const localExtraFieldLength = localHeader.readUInt16LE(28);
    entries.set(fileName, {
      dataOffset: localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength,
      uncompressedSize,
    });

    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return entries;
};

const requireStoredZipEntry = (entries: Map<string, ZipStoredEntry>, name: string) => {
  const entry = entries.get(name);
  if (!entry) {
    throw new Error(`Validated regression fixture ZIP is missing ${name}.`);
  }
  return entry;
};

const readBmpMetadata = async (file: FileHandle, entry: ZipStoredEntry) => {
  if (entry.uncompressedSize < 54) {
    throw new Error('Validated BMP fixture is truncated.');
  }

  const header = await readExactly(file, 54, entry.dataOffset);
  if (header.toString('ascii', 0, 2) !== 'BM') {
    throw new Error('Validated fixture source asset is not a BMP image.');
  }

  const width = header.readInt32LE(18);
  const rawHeight = header.readInt32LE(22);
  const bitsPerPixel = header.readUInt16LE(28);
  const compression = header.readUInt32LE(30);

  if ((bitsPerPixel !== 24 && bitsPerPixel !== 32) || compression !== 0) {
    throw new Error('Validated BMP fixture must be uncompressed 24-bit or 32-bit data.');
  }

  const height = Math.abs(rawHeight);
  return {
    bitsPerPixel,
    height,
    pixelArrayOffset: header.readUInt32LE(10),
    rowStride: Math.floor((bitsPerPixel * width + 31) / 32) * 4,
    topDown: rawHeight < 0,
    width,
  } satisfies BmpMetadata;
};

const rectToPixelRect = (rect: PreprocessRect, size: { width: number; height: number }): PixelRect => {
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

const expandPixelRect = (
  rect: PixelRect,
  size: { width: number; height: number },
  paddingRatio: number,
): PixelRect => {
  const paddingX = Math.round(rect.width * paddingRatio);
  const paddingY = Math.round(rect.height * paddingRatio);
  const x = clamp(rect.x - paddingX, 0, Math.max(0, size.width - 1));
  const y = clamp(rect.y - paddingY, 0, Math.max(0, size.height - 1));
  const right = clamp(rect.x + rect.width + paddingX, x + 1, size.width);
  const bottom = clamp(rect.y + rect.height + paddingY, y + 1, size.height);

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
};

const rebaseRectWithinCrop = (rect: PixelRect, crop: PixelRect): PreprocessRect => ({
  x: (rect.x - crop.x) / crop.width,
  y: (rect.y - crop.y) / crop.height,
  width: rect.width / crop.width,
  height: rect.height / crop.height,
});

const fitWithin = (width: number, height: number, maxEdge: number) => {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

const loadBmpCropImageData = async (args: {
  crop: PixelRect;
  entryName: string;
  entries: Map<string, ZipStoredEntry>;
  file: FileHandle;
  maxEdge: number;
}) => {
  const entry = requireStoredZipEntry(args.entries, args.entryName);
  const metadata = await readBmpMetadata(args.file, entry);
  const bytesPerPixel = metadata.bitsPerPixel / 8;
  const targetSize = fitWithin(args.crop.width, args.crop.height, args.maxEdge);
  const data = new Uint8ClampedArray(targetSize.width * targetSize.height * 4);
  const xOffsets = Array.from({ length: targetSize.width }, (_, index) => clamp(
    Math.floor((index + 0.5) * args.crop.width / targetSize.width),
    0,
    args.crop.width - 1,
  ) * bytesPerPixel);
  const rowSliceLength = args.crop.width * bytesPerPixel;
  let cachedRelativeRow = -1;
  let cachedRow = Buffer.alloc(0);

  for (let y = 0; y < targetSize.height; y += 1) {
    const relativeRow = clamp(
      Math.floor((y + 0.5) * args.crop.height / targetSize.height),
      0,
      args.crop.height - 1,
    );

    if (relativeRow !== cachedRelativeRow) {
      const sourceY = args.crop.y + relativeRow;
      const bmpRowIndex = metadata.topDown ? sourceY : metadata.height - 1 - sourceY;
      const rowStart = entry.dataOffset
        + metadata.pixelArrayOffset
        + bmpRowIndex * metadata.rowStride
        + args.crop.x * bytesPerPixel;
      cachedRow = await readExactly(args.file, rowSliceLength, rowStart);
      cachedRelativeRow = relativeRow;
    }

    for (let x = 0; x < targetSize.width; x += 1) {
      const sourceOffset = xOffsets[x];
      const targetOffset = (y * targetSize.width + x) * 4;
      data[targetOffset] = cachedRow[sourceOffset + 2] ?? 0;
      data[targetOffset + 1] = cachedRow[sourceOffset + 1] ?? 0;
      data[targetOffset + 2] = cachedRow[sourceOffset] ?? 0;
      data[targetOffset + 3] = 255;
    }
  }

  return new MockImageData(data, targetSize.width, targetSize.height) as unknown as ImageData;
};

const loadValidatedRegressionFixture = async () => {
  validatedRegressionFixturePromise ??= (async () => {
    const file = await open(VALIDATED_SAMPLE_ZIP_PATH, 'r');

    try {
      const entries = await readStoredZipEntries(file);
      const eosinMetadata = await readBmpMetadata(file, requireStoredZipEntry(entries, VALIDATED_SAMPLE_EOSIN_ENTRY));
      const heMetadata = await readBmpMetadata(file, requireStoredZipEntry(entries, VALIDATED_SAMPLE_HE_ENTRY));
      const eosinLocalizationRect = rectToPixelRect(VALIDATED_SAMPLE_LOCALIZATION_BOUNDS, eosinMetadata);
      const eosinCrop = expandPixelRect(eosinLocalizationRect, eosinMetadata, 0.05);
      const heFocusRect = rectToPixelRect(VALIDATED_SAMPLE_HE_FOCUS_BOUNDS, heMetadata);
      const heCrop = expandPixelRect(heFocusRect, heMetadata, 0.12);

      const [eosin, he] = await Promise.all([
        loadBmpCropImageData({
          crop: eosinCrop,
          entryName: VALIDATED_SAMPLE_EOSIN_ENTRY,
          entries,
          file,
          maxEdge: 1400,
        }),
        loadBmpCropImageData({
          crop: heCrop,
          entryName: VALIDATED_SAMPLE_HE_ENTRY,
          entries,
          file,
          maxEdge: 1800,
        }),
      ]);

      return {
        eosin,
        he,
        localizationBounds: rebaseRectWithinCrop(eosinLocalizationRect, eosinCrop),
      } satisfies ValidatedRegressionFixture;
    } finally {
      await file.close();
    }
  })();

  return validatedRegressionFixturePromise;
};

const buildCenteredRotationMatrix = (width: number, height: number, radians: number) => {
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return Float32Array.from([
    cos,
    -sin,
    centerX - cos * centerX + sin * centerY,
    sin,
    cos,
    centerY - sin * centerX - cos * centerY + centerY,
  ]);
};

const createFakeCv = (): OpenCvRuntime => ({
  Mat: FakeMat,
  matFromArray: (rows, cols, type, data) => new FakeMat(rows, cols, type, data),
  estimateAffine2D: () => new FakeMat(),
  warpAffine: () => undefined,
  matFromImageData: (imageData) => new FakeMat(imageData.height, imageData.width, 0, imageData.data),
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
  CV_32F: 5,
  INTER_LINEAR: 0,
  BORDER_CONSTANT: 0,
  TM_CCOEFF_NORMED: 5,
  MOTION_EUCLIDEAN: 1,
  TERM_CRITERIA_EPS: 2,
  TERM_CRITERIA_COUNT: 1,
  matchTemplate: (_image: CvMat, _templ: CvMat, result: CvMat) => {
    const score = 0.99;
    result.rows = 1;
    result.cols = 1;
    result.data32F = Float32Array.from([score]);
    result.data64F = Float64Array.from([score]);
    result.data = Uint8Array.from([Math.max(0, Math.min(255, Math.round((score + 1) * 127.5)))]);
    (result as CvMat & { __maxLoc?: { x: number; y: number } }).__maxLoc = {
      x: 12,
      y: 18,
    };
  },
  minMaxLoc: (src: CvMat) => {
    const presetLocation = (src as CvMat & { __maxLoc?: { x: number; y: number } }).__maxLoc;
    const data = src.data32F.length > 0 ? src.data32F : Float32Array.from(src.data64F);
    let minVal = Number.POSITIVE_INFINITY;
    let maxVal = Number.NEGATIVE_INFINITY;
    let minIndex = 0;
    let maxIndex = 0;

    for (let index = 0; index < data.length; index += 1) {
      const value = data[index];
      if (value < minVal) {
        minVal = value;
        minIndex = index;
      }
      if (value > maxVal) {
        maxVal = value;
        maxIndex = index;
      }
    }

    return {
      minVal,
      maxVal,
      minLoc: { x: minIndex % src.cols, y: Math.floor(minIndex / src.cols) },
      maxLoc: presetLocation ?? { x: maxIndex % src.cols, y: Math.floor(maxIndex / src.cols) },
    };
  },
  findTransformECC: (templateImage: CvMat, inputImage: CvMat, warpMatrix: CvMat) => {
    void inputImage;
    const matrix = buildCenteredRotationMatrix(templateImage.cols, templateImage.rows, (8 * Math.PI) / 180);
    warpMatrix.rows = 2;
    warpMatrix.cols = 3;
    warpMatrix.data32F = matrix;
    warpMatrix.data64F = Float64Array.from(matrix);
    warpMatrix.data = Uint8Array.from(matrix.map((value) => Math.max(0, Math.min(255, Math.round(value)))));
    return 0.92;
  },
} as OpenCvRuntime & Record<string, unknown>);

const setPixel = (data: Uint8ClampedArray, width: number, x: number, y: number, value: number) => {
  const offset = (y * width + x) * 4;
  data[offset] = value;
  data[offset + 1] = value;
  data[offset + 2] = value;
  data[offset + 3] = 255;
};

const createBlankImage = (width: number, height: number, value = 255) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      setPixel(data, width, x, y, value);
    }
  }
  return new MockImageData(data, width, height) as unknown as ImageData;
};

describe('runHeAutoLocalization', () => {
  it('returns accepted refinement for the restored validated sample asset', async () => {
    const fixture = await loadValidatedRegressionFixture();

    const result = await runHeAutoLocalization({
      cv: createFakeCv(),
      eosinSource: { imageData: fixture.eosin },
      heSource: { imageData: fixture.he },
      localizationBounds: fixture.localizationBounds,
      queryMaskSize: 96,
      coarseSearchHeight: 192,
      eccCanvasSize: 96,
      coarseScoreThreshold: 0.1,
    });

    expect(result.method).toBe(HE_AUTO_LOCALIZATION_METHOD);
    expect(result.failureReason).toBeNull();
    expect(result.coarseBounds).not.toBeNull();
    expect(result.refinedBounds).not.toBeNull();
    expect(result.refinedQuad).not.toBeNull();
    expect(result.acceptedTransform).not.toBeNull();
    expect(result.eccCorrelation).not.toBeNull();
    expect(result.eccCorrelation ?? 0).toBeGreaterThanOrEqual(0.75);
    expect(result.rotationDegrees ?? 0).toBeGreaterThan(4);
    expect(result.rotationDegrees ?? 0).toBeLessThan(12);
  }, 30_000);

  it('returns failed status when no coarse match can be established', async () => {
    const fixture = await loadValidatedRegressionFixture();
    const blankHe = createBlankImage(240, 240);

    const result = await runHeAutoLocalization({
      cv: createFakeCv(),
      eosinSource: { imageData: fixture.eosin },
      heSource: { imageData: blankHe },
      localizationBounds: fixture.localizationBounds,
      queryMaskSize: 96,
      coarseSearchHeight: 192,
      eccCanvasSize: 96,
      coarseScoreThreshold: 0.1,
    });

    expect(result.method).toBe(HE_AUTO_LOCALIZATION_METHOD);
    expect(result.coarseBounds).toBeNull();
    expect(result.refinedBounds).toBeNull();
    expect(result.refinedQuad).toBeNull();
    expect(result.acceptedTransform).toBeNull();
    expect(result.failureReason).toBe('insufficient-he-signal');
  });

  it('returns a typed failure when the runtime lacks template-search and ECC APIs', async () => {
    const fixture = await loadValidatedRegressionFixture();

    const incompleteRuntime = {
      ...createFakeCv(),
      matchTemplate: undefined,
      minMaxLoc: undefined,
      findTransformECC: undefined,
    } as unknown as OpenCvRuntime;

    const result = await runHeAutoLocalization({
      cv: incompleteRuntime,
      eosinSource: { imageData: fixture.eosin },
      heSource: { imageData: fixture.he },
      localizationBounds: fixture.localizationBounds,
      queryMaskSize: 96,
      coarseSearchHeight: 192,
      eccCanvasSize: 96,
      coarseScoreThreshold: 0.1,
    });

    expect(result.method).toBe(HE_AUTO_LOCALIZATION_METHOD);
    expect(result.coarseBounds).toBeNull();
    expect(result.refinedBounds).toBeNull();
    expect(result.refinedQuad).toBeNull();
    expect(result.acceptedTransform).toBeNull();
    expect(result.eccCorrelation).toBeNull();
    expect(result.rotationDegrees).toBeNull();
    expect(result.failureReason).toBe('runtime-missing-capabilities');
  });
});
