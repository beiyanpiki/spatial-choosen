import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import ts from 'typescript';

const PREPROCESS_STORAGE_KEY = 'spatial-preprocess-projects';
const PREPROCESS_DB_NAME = 'spatial-preprocess';
const PREPROCESS_DERIVED_IMAGE_STORE = 'preprocess-derived-images';

const cropQcFeatureMatchesDerivedImageStoreKey = (projectId: string) => `${projectId}:crop-qc:feature-matches`;

type CropQcHarnessPoint = {
  id: string;
  source: { x: number; y: number };
  target: { x: number; y: number };
};

type CropQcHarnessOutcome = {
  cropWidth: number;
  cropHeight: number;
  featureMatchesDataUrl: string | null;
  featureMatchesPreviewDataUrl: string | null;
  featureMatchesSize: {
    width: number;
    height: number;
  } | null;
};

let cropQcHarnessScriptsPromise: Promise<{
  cropQc: string;
  imageTransforms: string;
}> | null = null;

function transpileBrowserModule(source: string, fileName: string) {
  return ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      isolatedModules: true,
      esModuleInterop: true,
    },
  }).outputText;
}

async function loadCropQcHarnessScripts() {
  cropQcHarnessScriptsPromise ??= (async () => {
    const [cropQcSource, imageTransformsSource] = await Promise.all([
      fs.readFile(path.join(process.cwd(), 'src/lib/preprocess/cropQc.ts'), 'utf8'),
      fs.readFile(path.join(process.cwd(), 'src/lib/preprocess/imageTransforms.ts'), 'utf8'),
    ]);

    return {
      cropQc: transpileBrowserModule(cropQcSource, 'cropQc.ts'),
      imageTransforms: transpileBrowserModule(imageTransformsSource, 'imageTransforms.ts'),
    };
  })();

  return cropQcHarnessScriptsPromise;
}

async function runCropQcHarness(
  page: import('@playwright/test').Page,
  options: {
    controlPoints: CropQcHarnessPoint[];
    inlierMask: boolean[] | null;
  },
): Promise<CropQcHarnessOutcome> {
  const scripts = await loadCropQcHarnessScripts();

  return page.evaluate(async ({ scripts, options }) => {
    const moduleCache = new Map<string, { exports: Record<string, unknown> }>();

    const loadModule = (id: string) => {
      const cached = moduleCache.get(id);
      if (cached) {
        return cached.exports;
      }

      const source = id === 'cropQc'
        ? scripts.cropQc
        : id === 'imageTransforms'
          ? scripts.imageTransforms
          : null;
      if (!source) {
        throw new Error(`Unknown browser module: ${id}`);
      }

      const moduleContext = { exports: {} as Record<string, unknown> };
      moduleCache.set(id, moduleContext);

      const localRequire = (specifier: string) => {
        if (specifier === '@/lib/preprocess/imageTransforms') {
          return loadModule('imageTransforms');
        }

        throw new Error(`Unsupported require from ${id}: ${specifier}`);
      };

      new Function('require', 'module', 'exports', source)(localRequire, moduleContext, moduleContext.exports);
      return moduleContext.exports;
    };

    const { runCropQc } = loadModule('cropQc') as {
      runCropQc: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };

    class MockMat {
      rows: number;
      cols: number;
      data64F: Float64Array;
      data32F: Float32Array;
      data: Uint8ClampedArray;
      imageData: ImageData | null;

      constructor(rows = 0, cols = 0, values: ArrayLike<number> = []) {
        this.rows = rows;
        this.cols = cols;
        this.data64F = Float64Array.from(values);
        this.data32F = Float32Array.from(values);
        this.data = Uint8ClampedArray.from(values, (value) => Number(value));
        this.imageData = null;
      }

      empty() {
        return this.data64F.length === 0 && this.data32F.length === 0 && !this.imageData;
      }

      delete() {
        // No-op for the browser test double.
      }
    }

    class MockSize {
      constructor(public width: number, public height: number) {}
    }

    class MockScalar {
      values: [number, number, number, number];

      constructor(v0: number, v1 = 0, v2 = 0, v3 = 0) {
        this.values = [v0, v1, v2, v3];
      }
    }

    const createMockCv = () => ({
      Mat: MockMat,
      matFromArray: (rows: number, cols: number, _type: number, data: ArrayLike<number>) => new MockMat(rows, cols, data),
      matFromImageData: (imageData: ImageData) => {
        const mat = new MockMat(imageData.height, imageData.width);
        mat.imageData = imageData;
        mat.data = new Uint8ClampedArray(imageData.data);
        return mat;
      },
      warpAffine: (
        src: MockMat,
        dst: MockMat,
        matrix: MockMat,
        size: MockSize,
        _interpolation: number,
        _borderMode: number,
        fill: MockScalar,
      ) => {
        if (!src.imageData) {
          throw new Error('Missing source image data for warpAffine test double');
        }

        const values = Array.from(matrix.data64F.length > 0 ? matrix.data64F : matrix.data32F);
        const [m00, m01, tx, m10, m11, ty] = values;
        const determinant = m00 * m11 - m01 * m10;
        if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) {
          throw new Error('Non-invertible affine matrix in warpAffine test double');
        }

        const output = new ImageData(size.width, size.height);
        const srcData = src.imageData.data;
        const outData = output.data;
        const fillColor = fill.values;

        for (let y = 0; y < size.height; y += 1) {
          for (let x = 0; x < size.width; x += 1) {
            const srcX = (m11 * (x - tx) - m01 * (y - ty)) / determinant;
            const srcY = (-m10 * (x - tx) + m00 * (y - ty)) / determinant;
            const destOffset = (y * size.width + x) * 4;

            if (
              srcX < 0
              || srcY < 0
              || srcX > src.imageData.width - 1
              || srcY > src.imageData.height - 1
            ) {
              outData[destOffset] = fillColor[0];
              outData[destOffset + 1] = fillColor[1];
              outData[destOffset + 2] = fillColor[2];
              outData[destOffset + 3] = fillColor[3];
              continue;
            }

            const sampleX = Math.max(0, Math.min(src.imageData.width - 1, Math.round(srcX)));
            const sampleY = Math.max(0, Math.min(src.imageData.height - 1, Math.round(srcY)));
            const srcOffset = (sampleY * src.imageData.width + sampleX) * 4;
            outData[destOffset] = srcData[srcOffset];
            outData[destOffset + 1] = srcData[srcOffset + 1];
            outData[destOffset + 2] = srcData[srcOffset + 2];
            outData[destOffset + 3] = srcData[srcOffset + 3];
          }
        }

        dst.rows = size.height;
        dst.cols = size.width;
        dst.imageData = output;
        dst.data = new Uint8ClampedArray(output.data);
      },
      Size: MockSize,
      Scalar: MockScalar,
      RANSAC: 8,
      CV_64F: 0,
      CV_8U: 1,
      INTER_LINEAR: 1,
      BORDER_CONSTANT: 0,
    });

    const fullWidth = 320;
    const fullHeight = 240;
    const cropSize = 140;
    const cropOrigin = { x: 56, y: 48 };
    const chipBounds = {
      x: cropOrigin.x / fullWidth,
      y: cropOrigin.y / fullHeight,
      width: cropSize / fullWidth,
      height: cropSize / fullHeight,
    };

    const createScenes = () => {
      const eosinCanvas = document.createElement('canvas');
      eosinCanvas.width = fullWidth;
      eosinCanvas.height = fullHeight;
      const eosinContext = eosinCanvas.getContext('2d');
      if (!eosinContext) {
        throw new Error('Canvas unavailable for eosin fixture');
      }

      eosinContext.fillStyle = 'rgb(224,224,224)';
      eosinContext.fillRect(0, 0, fullWidth, fullHeight);
      eosinContext.fillStyle = 'rgb(210,120,120)';
      eosinContext.fillRect(cropOrigin.x, cropOrigin.y, cropSize, cropSize);
      eosinContext.fillStyle = 'rgb(50,170,90)';
      eosinContext.fillRect(cropOrigin.x + 18, cropOrigin.y + 22, 34, 34);
      eosinContext.fillStyle = 'rgb(60,100,220)';
      eosinContext.fillRect(cropOrigin.x + 82, cropOrigin.y + 86, 40, 40);

      const heCanvas = document.createElement('canvas');
      heCanvas.width = cropSize;
      heCanvas.height = cropSize;
      const heContext = heCanvas.getContext('2d');
      if (!heContext) {
        throw new Error('Canvas unavailable for HE fixture');
      }

      heContext.fillStyle = 'rgb(210,120,120)';
      heContext.fillRect(0, 0, cropSize, cropSize);
      heContext.fillStyle = 'rgb(50,170,90)';
      heContext.fillRect(18, 22, 34, 34);
      heContext.fillStyle = 'rgb(60,100,220)';
      heContext.fillRect(82, 86, 40, 40);

      return {
        eosinDataUrl: eosinCanvas.toDataURL('image/png'),
        heDataUrl: heCanvas.toDataURL('image/png'),
      };
    };

    const scenes = createScenes();
    const result = await runCropQc({
      cv: createMockCv(),
      eosinDataUrl: scenes.eosinDataUrl,
      heDataUrl: scenes.heDataUrl,
      chipBounds,
      imageTransform: {
        rotationDegrees: 0,
        flipHorizontal: false,
        flipVertical: false,
        scale: 1,
      },
      affineMatrix: [1, 0, cropOrigin.x, 0, 1, cropOrigin.y],
      controlPoints: options.controlPoints,
      inlierMask: options.inlierMask,
    });

    const featureMatchesDataUrl = typeof result.featureMatchesDataUrl === 'string'
      ? result.featureMatchesDataUrl
      : null;
    const featureMatchesPreviewDataUrl = result.featureMatchesPreview
      && typeof result.featureMatchesPreview === 'object'
      && typeof (result.featureMatchesPreview as { dataUrl?: unknown }).dataUrl === 'string'
      ? (result.featureMatchesPreview as { dataUrl: string }).dataUrl
      : null;

    const featureMatchesSize = featureMatchesDataUrl
      ? await new Promise<{ width: number; height: number }>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
          image.onerror = () => reject(new Error('Failed to decode feature matches preview'));
          image.src = featureMatchesDataUrl;
        })
      : null;

    return {
      cropWidth: typeof result.cropWidth === 'number' ? result.cropWidth : 0,
      cropHeight: typeof result.cropHeight === 'number' ? result.cropHeight : 0,
      featureMatchesDataUrl,
      featureMatchesPreviewDataUrl,
      featureMatchesSize,
    };
  }, {
    scripts,
    options,
  });
}

function buildFocusedCropPoint(id: string, x: number, y: number): CropQcHarnessPoint {
  const cropBounds = {
    x: 56 / 320,
    y: 48 / 240,
    width: 140 / 320,
    height: 140 / 240,
  };

  return {
    id,
    source: {
      x: cropBounds.x + x * cropBounds.width,
      y: cropBounds.y + y * cropBounds.height,
    },
    target: { x, y },
  };
}

function alignmentLocators(page: import('@playwright/test').Page) {
  return {
    sourceCanvas: page.getByTestId('alignment-add-point-eosin'),
    targetCanvas: page.getByTestId('alignment-add-point-he'),
    workflowOverlay: page.getByTestId('alignment-workflow-overlay'),
    workflowInstruction: page.getByTestId('alignment-workflow-instruction'),
    selectedPairBadge: page.getByTestId('alignment-selected-pair-badge'),
    repositionSourceButton: page.getByTestId('alignment-select-reposition-source'),
    repositionTargetButton: page.getByTestId('alignment-select-reposition-target'),
    deletePairButton: page.getByTestId('alignment-select-delete-pair'),
    cancelSelectionButton: page.getByTestId('alignment-select-cancel'),
  };
}

async function expectAwaitingSource(page: import('@playwright/test').Page) {
  await expect(alignmentLocators(page).workflowInstruction).toContainText(/eosin canvas/i);
}

async function createProject(page: import('@playwright/test').Page, name: string) {
  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill(name);
  await page.getByTestId('preprocess-create-project').click();
  await expect(page).toHaveURL(/preprocess_id=/);
}

async function getCurrentPreprocessId(page: import('@playwright/test').Page) {
  const url = new URL(page.url());
  const preprocessId = url.searchParams.get('preprocess_id');
  if (!preprocessId) throw new Error('Missing preprocess_id in URL');
  return preprocessId;
}

async function readFeatureMatchesStorageState(
  page: import('@playwright/test').Page,
  preprocessId: string,
) {
  return page.evaluate(async ({
    preprocessId,
    preprocessStorageKey,
    preprocessDbName,
    preprocessDerivedImageStore,
    derivedImageKey,
  }) => {
    const raw = window.localStorage.getItem(preprocessStorageKey);
    const projects = raw ? JSON.parse(raw) as Array<Record<string, unknown>> : [];
    const project = projects.find((entry) => entry.id === preprocessId) ?? null;
    const cropQc = project && typeof project.cropQc === 'object' && project.cropQc !== null
      ? project.cropQc as Record<string, unknown>
      : null;
    const featureMatchesPreview = cropQc?.featureMatchesPreview && typeof cropQc.featureMatchesPreview === 'object'
      ? cropQc.featureMatchesPreview as Record<string, unknown>
      : null;

    const derivedValue = await new Promise<Blob | string | undefined>((resolve, reject) => {
      const openRequest = window.indexedDB.open(preprocessDbName);
      openRequest.onerror = () => reject(openRequest.error);
      openRequest.onsuccess = () => {
        const db = openRequest.result;
        const tx = db.transaction(preprocessDerivedImageStore, 'readonly');
        const request = tx.objectStore(preprocessDerivedImageStore).get(derivedImageKey);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result as Blob | string | undefined);
      };
    });

    const derivedDataUrl = await new Promise<string | null>((resolve, reject) => {
      if (derivedValue instanceof Blob) {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.readAsDataURL(derivedValue);
        return;
      }

      resolve(typeof derivedValue === 'string' ? derivedValue : null);
    });

    return {
      projectExists: Boolean(project),
      metaAlias: cropQc?.featureMatchesPreviewDataUrl ?? null,
      metaNested: featureMatchesPreview?.dataUrl ?? null,
      derivedKind: derivedValue instanceof Blob ? 'blob' : typeof derivedValue === 'string' ? 'string' : null,
      derivedSize: derivedValue instanceof Blob ? derivedValue.size : typeof derivedValue === 'string' ? derivedValue.length : 0,
      derivedDataUrl,
    };
  }, {
    preprocessId,
    preprocessStorageKey: PREPROCESS_STORAGE_KEY,
    preprocessDbName: PREPROCESS_DB_NAME,
    preprocessDerivedImageStore: PREPROCESS_DERIVED_IMAGE_STORE,
    derivedImageKey: cropQcFeatureMatchesDerivedImageStoreKey(preprocessId),
  });
}

async function seedLegacyFeatureMatchesFallbackState(
  page: import('@playwright/test').Page,
  preprocessId: string,
) {
  return page.evaluate(async ({
    preprocessId,
    preprocessStorageKey,
    preprocessDbName,
    preprocessDerivedImageStore,
    derivedImageKey,
  }) => {
    const raw = window.localStorage.getItem(preprocessStorageKey);
    if (!raw) {
      throw new Error('No preprocess storage payload found');
    }

    const projects = JSON.parse(raw) as Array<Record<string, unknown>>;
    const makeImage = (fill: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = 120;
      canvas.height = 120;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable for feature matches fallback seed');
      context.fillStyle = fill;
      context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    };

    const aliasDataUrl = makeImage('rgb(90,170,90)');
    const nestedDataUrl = makeImage('rgb(80,90,210)');
    const nextProjects = projects.map((project) => {
      if (project.id !== preprocessId) return project;
      const cropQc = project.cropQc as Record<string, unknown> | null | undefined;
      if (!cropQc) {
        throw new Error('Missing cropQc state');
      }

      return {
        ...project,
        cropQc: {
          ...cropQc,
          featureMatchesPreviewDataUrl: aliasDataUrl,
          featureMatchesPreview: {
            dataUrl: nestedDataUrl,
          },
        },
      };
    });

    window.localStorage.setItem(preprocessStorageKey, JSON.stringify(nextProjects));

    await new Promise<void>((resolve, reject) => {
      const openRequest = window.indexedDB.open(preprocessDbName);
      openRequest.onerror = () => reject(openRequest.error);
      openRequest.onsuccess = () => {
        const db = openRequest.result;
        const tx = db.transaction(preprocessDerivedImageStore, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
        tx.objectStore(preprocessDerivedImageStore).delete(derivedImageKey);
      };
    });

    return {
      aliasDataUrl,
      nestedDataUrl,
    };
  }, {
    preprocessId,
    preprocessStorageKey: PREPROCESS_STORAGE_KEY,
    preprocessDbName: PREPROCESS_DB_NAME,
    preprocessDerivedImageStore: PREPROCESS_DERIVED_IMAGE_STORE,
    derivedImageKey: cropQcFeatureMatchesDerivedImageStoreKey(preprocessId),
  });
}

async function stripLegacyFeatureMatchesPreviewFields(
  page: import('@playwright/test').Page,
  preprocessId: string,
) {
  await page.evaluate(({ preprocessId, preprocessStorageKey }) => {
    const raw = window.localStorage.getItem(preprocessStorageKey);
    if (!raw) {
      throw new Error('No preprocess storage payload found');
    }

    const projects = JSON.parse(raw) as Array<Record<string, unknown>>;
    const nextProjects = projects.map((project) => {
      if (project.id !== preprocessId) return project;
      const cropQc = project.cropQc as Record<string, unknown> | null | undefined;
      if (!cropQc) {
        throw new Error('Missing cropQc state');
      }

      const nextCropQc = { ...cropQc };
      delete nextCropQc.featureMatchesPreviewDataUrl;
      delete nextCropQc.featureMatchesPreview;

      return {
        ...project,
        cropQc: nextCropQc,
      };
    });

    window.localStorage.setItem(preprocessStorageKey, JSON.stringify(nextProjects));
  }, {
    preprocessId,
    preprocessStorageKey: PREPROCESS_STORAGE_KEY,
  });
}

async function seedFocusedHeConsumerState(
  page: import('@playwright/test').Page,
  currentStep: 'alignment' | 'cropQc',
) {
  const preprocessId = await getCurrentPreprocessId(page);

  return page.evaluate(({ preprocessId, currentStep, preprocessStorageKey }) => {
    const raw = window.localStorage.getItem(preprocessStorageKey);
    if (!raw) {
      throw new Error('No preprocess storage payload found');
    }

    const projects = JSON.parse(raw) as Array<Record<string, unknown>>;
    const makeImage = (width: number, height: number, fill: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable for seeded image');
      context.fillStyle = fill;
      context.fillRect(0, 0, width, height);
      return {
        dataUrl: canvas.toDataURL('image/png'),
        width,
        height,
      };
    };

    const eosin = makeImage(320, 240, 'rgb(180,180,180)');
    const originalHe = makeImage(320, 240, 'rgb(40,90,220)');
    const focusedHe = makeImage(140, 140, 'rgb(220,60,60)');
    const now = new Date().toISOString();

    const nextProjects = projects.map((project) => {
      if (project.id !== preprocessId) return project;

      return {
        ...project,
        currentStep,
        updatedAt: now,
        sourceAssets: {
          ...(project.sourceAssets as Record<string, unknown>),
          status: 'ready',
          isStale: false,
          updatedAt: now,
          images: {
            eosin: {
              id: `seed-eosin-${preprocessId}`,
              kind: 'eosin',
              fileName: 'eosin.png',
              mimeType: 'image/png',
              sizeBytes: eosin.dataUrl.length,
              width: eosin.width,
              height: eosin.height,
              lastModified: Date.now(),
              dataUrl: eosin.dataUrl,
              thumbnailDataUrl: eosin.dataUrl,
            },
            he: {
              id: `seed-he-${preprocessId}`,
              kind: 'he',
              fileName: 'he.png',
              mimeType: 'image/png',
              sizeBytes: originalHe.dataUrl.length,
              width: originalHe.width,
              height: originalHe.height,
              lastModified: Date.now(),
              dataUrl: originalHe.dataUrl,
              thumbnailDataUrl: originalHe.dataUrl,
            },
          },
        },
        localization: {
          ...(project.localization as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          chipBounds: {
            x: 0.05,
            y: 0.08,
            width: 0.24,
            height: 0.32,
          },
          handles: [],
          imageTransform: {
            rotationDegrees: 0,
            flipHorizontal: false,
            flipVertical: false,
            scale: 1,
          },
          error: null,
        },
        heFocus: {
          ...(project.heFocus as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          chipBounds: {
            x: 0.08,
            y: 0.04,
            width: 0.4375,
            height: 0.5833333333333334,
          },
          handles: [],
          imageTransform: {
            rotationDegrees: 0,
            flipHorizontal: false,
            flipVertical: false,
            scale: 1,
          },
          focusedImageDataUrl: focusedHe.dataUrl,
          error: null,
        },
        alignment: {
          ...(project.alignment as Record<string, unknown>),
          status: currentStep === 'alignment' ? 'ready' : 'complete',
          isStale: false,
          updatedAt: now,
          referenceImage: 'eosin',
          movingImage: 'he',
          controlPoints: [
            {
              id: 'seed-pair-1',
              source: { x: 0.12, y: 0.12 },
              target: { x: 0.12, y: 0.12 },
            },
          ],
          affineMatrix: currentStep === 'cropQc' ? [1, 0, 0, 0, 1, 0] : null,
          inlierMask: currentStep === 'cropQc' ? [true] : null,
          reprojectionRmse: currentStep === 'cropQc' ? 0 : null,
          inlierRatio: currentStep === 'cropQc' ? 1 : null,
          ransacReprojThreshold: currentStep === 'cropQc' ? 3 : null,
          qualityFlags: {
            minPairs: currentStep === 'cropQc',
            inlierRatio: currentStep === 'cropQc',
            rmse: currentStep === 'cropQc',
            finiteMatrix: currentStep === 'cropQc',
            scaleRange: currentStep === 'cropQc',
            accepted: currentStep === 'cropQc',
          },
          solveAccepted: currentStep === 'cropQc',
          failureReason: null,
          transform: null,
          previewDataUrl: null,
          error: null,
        },
        cropQc: {
          ...(project.cropQc as Record<string, unknown>),
          status: currentStep === 'cropQc' ? 'ready' : 'idle',
          isStale: false,
          updatedAt: now,
          cropRect: null,
          cropWidth: null,
          cropHeight: null,
          qcAccepted: false,
          eosinPreviewDataUrl: null,
          previewDataUrl: null,
          checkerboardPreviewDataUrl: null,
          error: null,
        },
      };
    });

    window.localStorage.setItem(preprocessStorageKey, JSON.stringify(nextProjects));

    return {
      focusedHeDataUrl: focusedHe.dataUrl,
      originalHeDataUrl: originalHe.dataUrl,
    };
  }, {
    preprocessId,
    currentStep,
    preprocessStorageKey: PREPROCESS_STORAGE_KEY,
  });
}

async function seedFocusedHeSolveScenario(page: import('@playwright/test').Page) {
  const preprocessId = await getCurrentPreprocessId(page);

  return page.evaluate(({ preprocessId, preprocessStorageKey }) => {
    const raw = window.localStorage.getItem(preprocessStorageKey);
    if (!raw) {
      throw new Error('No preprocess storage payload found');
    }

    const projects = JSON.parse(raw) as Array<Record<string, unknown>>;
    const now = new Date().toISOString();
    const fullWidth = 320;
    const fullHeight = 240;
    const cropSize = 140;
    const cropOrigin = { x: 56, y: 48 };
    const cropBounds = {
      x: cropOrigin.x / fullWidth,
      y: cropOrigin.y / fullHeight,
      width: cropSize / fullWidth,
      height: cropSize / fullHeight,
    };
    const localPoints = [
      { x: 0.1, y: 0.25 },
      { x: 0.75, y: 0.28 },
      { x: 0.2, y: 0.56 },
      { x: 0.55, y: 0.45 },
      { x: 0.84, y: 0.58 },
      { x: 0.16, y: 0.8 },
      { x: 0.48, y: 0.84 },
      { x: 0.84, y: 0.92 },
    ];
    const controlPoints = localPoints.map((point, index) => ({
      id: `solve-pair-${index + 1}`,
      source: {
        x: cropBounds.x + point.x * cropBounds.width,
        y: cropBounds.y + point.y * cropBounds.height,
      },
      target: point,
    }));

    const makeScene = () => {
      const fullCanvas = document.createElement('canvas');
      fullCanvas.width = fullWidth;
      fullCanvas.height = fullHeight;
      const fullContext = fullCanvas.getContext('2d');
      if (!fullContext) throw new Error('Canvas unavailable for solve scenario');
      fullContext.fillStyle = 'rgb(210,210,210)';
      fullContext.fillRect(0, 0, fullWidth, fullHeight);
      fullContext.fillStyle = 'rgb(220,60,60)';
      fullContext.fillRect(cropOrigin.x, cropOrigin.y, cropSize, cropSize);
      fullContext.fillStyle = 'rgb(40,190,90)';
      fullContext.fillRect(cropOrigin.x + 14, cropOrigin.y + 14, 36, 36);
      fullContext.fillStyle = 'rgb(60,100,230)';
      fullContext.fillRect(cropOrigin.x + 90, cropOrigin.y + 90, 36, 36);

      const focusedCanvas = document.createElement('canvas');
      focusedCanvas.width = cropSize;
      focusedCanvas.height = cropSize;
      const focusedContext = focusedCanvas.getContext('2d');
      if (!focusedContext) throw new Error('Focused canvas unavailable for solve scenario');
      focusedContext.drawImage(
        fullCanvas,
        cropOrigin.x,
        cropOrigin.y,
        cropSize,
        cropSize,
        0,
        0,
        cropSize,
        cropSize,
      );

      const originalHeCanvas = document.createElement('canvas');
      originalHeCanvas.width = fullWidth;
      originalHeCanvas.height = fullHeight;
      const originalHeContext = originalHeCanvas.getContext('2d');
      if (!originalHeContext) throw new Error('Original HE canvas unavailable for solve scenario');
      originalHeContext.fillStyle = 'rgb(30,60,180)';
      originalHeContext.fillRect(0, 0, fullWidth, fullHeight);

      return {
        eosin: fullCanvas.toDataURL('image/png'),
        originalHe: originalHeCanvas.toDataURL('image/png'),
        focusedHe: focusedCanvas.toDataURL('image/png'),
        cropBounds,
      };
    };

    const scene = makeScene();
    const nextProjects = projects.map((project) => {
      if (project.id !== preprocessId) return project;

      return {
        ...project,
        currentStep: 'alignment',
        updatedAt: now,
        sourceAssets: {
          ...(project.sourceAssets as Record<string, unknown>),
          status: 'ready',
          isStale: false,
          updatedAt: now,
          images: {
            eosin: {
              id: `solve-eosin-${preprocessId}`,
              kind: 'eosin',
              fileName: 'solve-eosin.png',
              mimeType: 'image/png',
              sizeBytes: scene.eosin.length,
              width: fullWidth,
              height: fullHeight,
              lastModified: Date.now(),
              dataUrl: scene.eosin,
              thumbnailDataUrl: scene.eosin,
            },
            he: {
              id: `solve-he-${preprocessId}`,
              kind: 'he',
              fileName: 'solve-he.png',
              mimeType: 'image/png',
              sizeBytes: scene.originalHe.length,
              width: fullWidth,
              height: fullHeight,
              lastModified: Date.now(),
              dataUrl: scene.originalHe,
              thumbnailDataUrl: scene.originalHe,
            },
          },
        },
        localization: {
          ...(project.localization as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          chipBounds: scene.cropBounds,
          handles: [],
          imageTransform: {
            rotationDegrees: 0,
            flipHorizontal: false,
            flipVertical: false,
            scale: 1,
          },
          error: null,
        },
        heFocus: {
          ...(project.heFocus as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          chipBounds: scene.cropBounds,
          handles: [],
          imageTransform: {
            rotationDegrees: 0,
            flipHorizontal: false,
            flipVertical: false,
            scale: 1,
          },
          focusedImageDataUrl: scene.focusedHe,
          error: null,
        },
        alignment: {
          ...(project.alignment as Record<string, unknown>),
          status: 'ready',
          isStale: false,
          updatedAt: now,
          referenceImage: 'eosin',
          movingImage: 'he',
          controlPoints,
          affineMatrix: null,
          inlierMask: null,
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
          error: null,
        },
        cropQc: {
          ...(project.cropQc as Record<string, unknown>),
          status: 'idle',
          isStale: false,
          updatedAt: now,
          cropRect: null,
          cropWidth: null,
          cropHeight: null,
          qcAccepted: false,
          eosinPreviewDataUrl: null,
          previewDataUrl: null,
          checkerboardPreviewDataUrl: null,
          error: null,
        },
      };
    });

    window.localStorage.setItem(preprocessStorageKey, JSON.stringify(nextProjects));

    return {
      cropBounds: scene.cropBounds,
      pairCount: controlPoints.length,
    };
  }, {
    preprocessId,
    preprocessStorageKey: PREPROCESS_STORAGE_KEY,
  });
}

async function seedDangerousContinueScenario(
  page: import('@playwright/test').Page,
  mode: 'rejected' | 'accepted-with-outliers' = 'rejected',
) {
  const preprocessId = await getCurrentPreprocessId(page);

  return page.evaluate(({ preprocessId, preprocessStorageKey, mode }) => {
    const raw = window.localStorage.getItem(preprocessStorageKey);
    if (!raw) {
      throw new Error('No preprocess storage payload found');
    }

    const projects = JSON.parse(raw) as Array<Record<string, unknown>>;
    const now = new Date().toISOString();
    const width = 320;
    const height = 240;

    const makeImage = (fill: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable for dangerous continue scenario');
      context.fillStyle = fill;
      context.fillRect(0, 0, width, height);
      return canvas.toDataURL('image/png');
    };

    const eosinDataUrl = makeImage('rgb(180,180,180)');
    const heDataUrl = makeImage('rgb(210,120,120)');
    const controlPoints = [
      { id: 'danger-1', source: { x: 0.15, y: 0.2 }, target: { x: 0.15, y: 0.2 } },
      { id: 'danger-2', source: { x: 0.28, y: 0.22 }, target: { x: 0.28, y: 0.22 } },
      { id: 'danger-3', source: { x: 0.42, y: 0.3 }, target: { x: 0.42, y: 0.3 } },
      { id: 'danger-4', source: { x: 0.58, y: 0.36 }, target: { x: 0.58, y: 0.36 } },
      { id: 'danger-5', source: { x: 0.72, y: 0.46 }, target: { x: 0.72, y: 0.46 } },
      { id: 'danger-6', source: { x: 0.24, y: 0.62 }, target: { x: 0.24, y: 0.62 } },
      { id: 'danger-7', source: { x: 0.46, y: 0.72 }, target: { x: 0.46, y: 0.72 } },
      { id: 'danger-8', source: { x: 0.7, y: 0.78 }, target: { x: 0.7, y: 0.78 } },
      { id: 'danger-9', source: { x: 0.82, y: 0.24 }, target: { x: 0.18, y: 0.88 } },
      { id: 'danger-10', source: { x: 0.84, y: 0.82 }, target: { x: 0.16, y: 0.14 } },
    ];

    const nextProjects = projects.map((project) => {
      if (project.id !== preprocessId) return project;

      return {
        ...project,
        currentStep: 'alignment',
        updatedAt: now,
        sourceAssets: {
          ...(project.sourceAssets as Record<string, unknown>),
          status: 'ready',
          isStale: false,
          updatedAt: now,
          images: {
            eosin: {
              id: `danger-eosin-${preprocessId}`,
              kind: 'eosin',
              fileName: 'eosin.png',
              mimeType: 'image/png',
              sizeBytes: eosinDataUrl.length,
              width,
              height,
              lastModified: Date.now(),
              dataUrl: eosinDataUrl,
              thumbnailDataUrl: eosinDataUrl,
            },
            he: {
              id: `danger-he-${preprocessId}`,
              kind: 'he',
              fileName: 'he.png',
              mimeType: 'image/png',
              sizeBytes: heDataUrl.length,
              width,
              height,
              lastModified: Date.now(),
              dataUrl: heDataUrl,
              thumbnailDataUrl: heDataUrl,
            },
          },
        },
        localization: {
          ...(project.localization as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          chipBounds: {
            x: 0.1,
            y: 0.1,
            width: 0.8,
            height: 0.8,
          },
          handles: [],
          imageTransform: {
            rotationDegrees: 0,
            flipHorizontal: false,
            flipVertical: false,
            scale: 1,
          },
          error: null,
        },
        heFocus: {
          ...(project.heFocus as Record<string, unknown>),
          status: 'idle',
          isStale: false,
          updatedAt: now,
          chipBounds: null,
          handles: [],
          imageTransform: {
            rotationDegrees: 0,
            flipHorizontal: false,
            flipVertical: false,
            scale: 1,
          },
          focusedImageDataUrl: null,
          error: null,
        },
        alignment: {
          ...(project.alignment as Record<string, unknown>),
          status: mode === 'accepted-with-outliers' ? 'complete' : 'error',
          isStale: false,
          updatedAt: now,
          referenceImage: 'eosin',
          movingImage: 'he',
          controlPoints,
          affineMatrix: [1, 0, 0, 0, 1, 0],
          inlierMask: [true, true, true, true, true, true, true, true, false, false],
          reprojectionRmse: 1.5,
          inlierRatio: 0.8,
          ransacReprojThreshold: 3,
          qualityFlags: {
            minPairs: true,
            inlierRatio: true,
            rmse: true,
            finiteMatrix: true,
            scaleRange: true,
            accepted: mode === 'accepted-with-outliers',
          },
          solveAccepted: mode === 'accepted-with-outliers',
          failureReason: mode === 'accepted-with-outliers' ? null : 'rmse-too-high',
          transform: null,
          previewDataUrl: null,
          error: mode === 'accepted-with-outliers' ? null : 'rmse-too-high',
        },
        cropQc: {
          ...(project.cropQc as Record<string, unknown>),
          status: 'idle',
          isStale: false,
          updatedAt: now,
          cropRect: null,
          cropWidth: null,
          cropHeight: null,
          qcAccepted: false,
          eosinPreviewDataUrl: null,
          previewDataUrl: null,
          checkerboardPreviewDataUrl: null,
          error: null,
        },
      };
    });

    window.localStorage.setItem(preprocessStorageKey, JSON.stringify(nextProjects));
  }, {
    preprocessId,
    mode,
    preprocessStorageKey: PREPROCESS_STORAGE_KEY,
  });
}

async function seedCompletedDownstreamState(page: import('@playwright/test').Page) {
  const preprocessId = await getCurrentPreprocessId(page);

  return page.evaluate(({ preprocessId, preprocessStorageKey }) => {
    const raw = window.localStorage.getItem(preprocessStorageKey);
    if (!raw) {
      throw new Error('No preprocess storage payload found');
    }

    const projects = JSON.parse(raw) as Array<Record<string, unknown>>;
    const makeImage = (width: number, height: number, fill: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable for seeded image');
      context.fillStyle = fill;
      context.fillRect(0, 0, width, height);
      return canvas.toDataURL('image/png');
    };

    const eosinDataUrl = makeImage(320, 240, 'rgb(180,180,180)');
    const originalHeDataUrl = makeImage(320, 240, 'rgb(40,90,220)');
    const focusedHeDataUrl = makeImage(140, 140, 'rgb(220,60,60)');
    const createCropAssetSet = (baseFill: string) => ({
      fullres: { dataUrl: makeImage(120, 120, baseFill) },
      hires: { dataUrl: makeImage(96, 96, baseFill) },
      lowres: { dataUrl: makeImage(64, 64, baseFill) },
    });
    const eosinCropAssets = createCropAssetSet('rgb(200,80,80)');
    const heCropAssets = createCropAssetSet('rgb(80,80,200)');
    const checkerboardDataUrl = makeImage(120, 120, 'rgb(200,120,120)');
    const featureMatchesDataUrl = makeImage(120, 120, 'rgb(90,170,90)');
    const now = new Date().toISOString();

    const nextProjects = projects.map((project) => {
      if (project.id !== preprocessId) return project;

      return {
        ...project,
        currentStep: 'heFocus',
        updatedAt: now,
        sourceAssets: {
          ...(project.sourceAssets as Record<string, unknown>),
          status: 'ready',
          isStale: false,
          updatedAt: now,
          images: {
            eosin: {
              id: `seed-eosin-${preprocessId}`,
              kind: 'eosin',
              fileName: 'eosin.png',
              mimeType: 'image/png',
              sizeBytes: eosinDataUrl.length,
              width: 320,
              height: 240,
              lastModified: Date.now(),
              dataUrl: eosinDataUrl,
              thumbnailDataUrl: eosinDataUrl,
            },
            he: {
              id: `seed-he-${preprocessId}`,
              kind: 'he',
              fileName: 'he.png',
              mimeType: 'image/png',
              sizeBytes: originalHeDataUrl.length,
              width: 320,
              height: 240,
              lastModified: Date.now(),
              dataUrl: originalHeDataUrl,
              thumbnailDataUrl: originalHeDataUrl,
            },
          },
        },
        localization: {
          ...(project.localization as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          chipBounds: {
            x: 0.05,
            y: 0.08,
            width: 0.24,
            height: 0.32,
          },
          handles: [],
          imageTransform: {
            rotationDegrees: 0,
            flipHorizontal: false,
            flipVertical: false,
            scale: 1,
          },
          error: null,
        },
        heFocus: {
          ...(project.heFocus as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          chipBounds: {
            x: 0.08,
            y: 0.04,
            width: 0.4375,
            height: 0.5833333333333334,
          },
          handles: [],
          imageTransform: {
            rotationDegrees: 0,
            flipHorizontal: false,
            flipVertical: false,
            scale: 1,
          },
          focusedImageDataUrl: focusedHeDataUrl,
          error: null,
        },
        alignment: {
          ...(project.alignment as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          referenceImage: 'eosin',
          movingImage: 'he',
          controlPoints: [
            {
              id: 'seed-pair-1',
              source: { x: 0.12, y: 0.12 },
              target: { x: 0.12, y: 0.12 },
            },
            {
              id: 'seed-pair-2',
              source: { x: 0.24, y: 0.2 },
              target: { x: 0.24, y: 0.2 },
            },
          ],
          affineMatrix: [1, 0, 0, 0, 1, 0],
          inlierMask: [true, true],
          reprojectionRmse: 0,
          inlierRatio: 1,
          ransacReprojThreshold: 3,
          qualityFlags: {
            minPairs: true,
            inlierRatio: true,
            rmse: true,
            finiteMatrix: true,
            scaleRange: true,
            accepted: true,
          },
          solveAccepted: true,
          failureReason: null,
          transform: null,
          previewDataUrl: null,
          error: null,
        },
        cropQc: {
          ...(project.cropQc as Record<string, unknown>),
          status: 'complete',
          isStale: false,
          updatedAt: now,
          cropRect: {
            x: 0.05,
            y: 0.08,
            width: 0.24,
            height: 0.32,
          },
          cropWidth: 120,
          cropHeight: 120,
          cropAssets: {
            eosin: eosinCropAssets,
            he: heCropAssets,
          },
          tissue_hires_scalef: 0.5,
          tissue_lowres_scalef: 0.25,
          spot_diameter_fullres: 12,
          fiducial_diameter_fullres: 20,
          qcAccepted: true,
          eosinPreviewDataUrl: eosinCropAssets.fullres.dataUrl,
          previewDataUrl: heCropAssets.fullres.dataUrl,
          checkerboardPreviewDataUrl: checkerboardDataUrl,
          featureMatchesPreviewDataUrl: featureMatchesDataUrl,
          featureMatchesPreview: {
            dataUrl: featureMatchesDataUrl,
          },
          error: null,
        },
      };
    });

    window.localStorage.setItem(preprocessStorageKey, JSON.stringify(nextProjects));
  }, {
    preprocessId,
    preprocessStorageKey: PREPROCESS_STORAGE_KEY,
  });
}

async function sampleImagePixel(
  locator: ReturnType<import('@playwright/test').Page['locator']>,
  xRatio = 0.25,
  yRatio = 0.25,
) {
  return locator.evaluate(async (image, { xRatio, yRatio }) => {
    if (!(image instanceof HTMLImageElement)) {
      throw new Error('Expected an image element');
    }
    const decoded = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error('Failed to decode preview image'));
      nextImage.src = image.src;
    });
    const canvas = document.createElement('canvas');
    canvas.width = decoded.naturalWidth;
    canvas.height = decoded.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable for image sampling');
    context.drawImage(decoded, 0, 0);
    const sampleX = Math.max(0, Math.min(decoded.naturalWidth - 1, Math.floor(decoded.naturalWidth * xRatio)));
    const sampleY = Math.max(0, Math.min(decoded.naturalHeight - 1, Math.floor(decoded.naturalHeight * yRatio)));
    const data = context.getImageData(sampleX, sampleY, 1, 1).data;
    return { r: data[0], g: data[1], b: data[2] };
  }, { xRatio, yRatio });
}

async function uploadAlignmentImages(page: import('@playwright/test').Page) {
  const eosinPath = path.join(process.cwd(), 'tests/fixtures/preprocess/eosin.png');
  const hePath = path.join(process.cwd(), 'tests/fixtures/preprocess/he.png');

  await page.getByTestId('preprocess-step-source-assets').click();
  await page.locator('input[type="file"]').first().setInputFiles(eosinPath);
  await page.locator('input[type="file"]').last().setInputFiles(hePath);

  await page.getByTestId('preprocess-step-localize').click();
  await expect(page.getByTestId('localize-canvas-surface')).toBeVisible();
  await page.getByTestId('localize-stage-reset').click();
  await expect(page.getByTestId('preprocess-step-he-focus')).toBeEnabled();
  await expect(page.getByTestId('preprocess-step-align')).toBeDisabled();
  await page.getByTestId('preprocess-step-he-focus').click();
  await expect(page.getByTestId('preprocess-he-focus-canvas-column')).toBeVisible();
  await page.getByTestId('he-focus-stage-reset').click();
  await expect(page.getByTestId('preprocess-step-align')).toBeEnabled();

  await page.getByTestId('preprocess-step-align').click();
  await expect(page.getByTestId('alignment-runtime-status-badge')).toContainText(/ready/i, { timeout: 180_000 });
}

async function addTenIdentityPairs(page: import('@playwright/test').Page) {
  const points = [
    { x: 0.18, y: 0.18 },
    { x: 0.3, y: 0.24 },
    { x: 0.42, y: 0.3 },
    { x: 0.54, y: 0.36 },
    { x: 0.24, y: 0.46 },
    { x: 0.4, y: 0.54 },
    { x: 0.58, y: 0.66 },
    { x: 0.74, y: 0.78 },
  ];

  const controlPoints = points.map((point, index) => ({
    id: `identity-${index + 1}`,
    source: point,
    target: point,
  }));

  await page.evaluate(({ preprocessId, preprocessStorageKey, controlPoints }) => {
    const raw = window.localStorage.getItem(preprocessStorageKey);
    if (!raw) {
      throw new Error('No preprocess storage payload found');
    }

    const now = new Date().toISOString();
    const projects = JSON.parse(raw) as Array<Record<string, unknown>>;
    const nextProjects = projects.map((project) => {
      if (project.id !== preprocessId) return project;

      const alignment = project.alignment as Record<string, unknown>;
      return {
        ...project,
        currentStep: 'alignment',
        updatedAt: now,
        alignment: {
          ...alignment,
          status: 'ready',
          isStale: false,
          updatedAt: now,
          controlPoints,
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
          error: null,
        },
      };
    });

    window.localStorage.setItem(preprocessStorageKey, JSON.stringify(nextProjects));
  }, {
    preprocessId: await getCurrentPreprocessId(page),
    preprocessStorageKey: PREPROCESS_STORAGE_KEY,
    controlPoints,
  });

  await page.reload();
  await expect(page.getByTestId('alignment-runtime-status-badge')).toContainText(/ready/i, { timeout: 180_000 });
  await expect(page.getByTestId('alignment-pair-count-badge')).toContainText('Pairs 8 / 15');
}

async function addTenClusteredPairs(page: import('@playwright/test').Page) {
  const points = [
    { x: 0.24, y: 0.72 },
    { x: 0.26, y: 0.73 },
    { x: 0.28, y: 0.74 },
    { x: 0.3, y: 0.75 },
    { x: 0.32, y: 0.76 },
    { x: 0.34, y: 0.77 },
    { x: 0.36, y: 0.78 },
    { x: 0.38, y: 0.79 },
    { x: 0.4, y: 0.8 },
    { x: 0.42, y: 0.81 },
  ];

  for (const point of points) {
    await clickAlignmentPoint(page, 'alignment-add-point-eosin', point);
    await clickAlignmentPoint(page, 'alignment-add-point-he', point);
  }

  await expect(page.getByTestId('alignment-pair-count-badge')).toContainText('Pairs 10 / 15');
}

async function clickAlignmentPoint(
  page: import('@playwright/test').Page,
  canvasTestId: 'alignment-add-point-eosin' | 'alignment-add-point-he',
  point: { x: number; y: number },
) {
  const canvas = page.getByTestId(canvasTestId);
  await expect(canvas).toBeVisible();
  const clickPosition = await canvas.evaluate((canvasNode, p) => {
    const img = canvasNode.querySelector('img');
    if (!(img instanceof HTMLImageElement)) {
      throw new Error('Alignment canvas image not found');
    }
    const imageRect = img.getBoundingClientRect();
    const canvasRect = canvasNode.getBoundingClientRect();
    return {
      x: imageRect.left - canvasRect.left + imageRect.width * p.x,
      y: imageRect.top - canvasRect.top + imageRect.height * p.y,
    };
  }, point);
  await canvas.click({ position: clickPosition, force: true });
}

async function getAlignmentImageBox(
  page: import('@playwright/test').Page,
  canvasTestId: 'alignment-add-point-eosin' | 'alignment-add-point-he',
) {
  return page.getByTestId(canvasTestId).locator('img').evaluate((img) => {
    const imageRect = img.getBoundingClientRect();
    const canvasRect = img.parentElement?.parentElement?.getBoundingClientRect() ?? img.parentElement?.getBoundingClientRect() ?? imageRect;

    return {
      left: Math.round(imageRect.left - canvasRect.left),
      top: Math.round(imageRect.top - canvasRect.top),
      width: Math.round(imageRect.width),
      height: Math.round(imageRect.height),
    };
  });
}

async function getAlignmentCirclePosition(
  page: import('@playwright/test').Page,
  canvasTestId: 'alignment-add-point-eosin' | 'alignment-add-point-he',
  index = 0,
) {
  return page
    .getByTestId(canvasTestId)
    .locator('svg circle')
    .nth(index)
    .evaluate((circle) => ({
      cx: Number(circle.getAttribute('cx')),
      cy: Number(circle.getAttribute('cy')),
    }));
}

test('guided pair creation keeps the complementary click contract and hides legacy global tools', async ({ page }) => {
  await createProject(page, `task15-guided-flow-${Date.now()}`);
  await uploadAlignmentImages(page);

  const locators = alignmentLocators(page);

  await expect(locators.workflowOverlay).toBeVisible();
  await expect(page.getByTestId('alignment-tool-add')).toHaveCount(0);
  await expect(page.getByTestId('alignment-tool-move')).toHaveCount(0);
  await expect(page.getByTestId('alignment-tool-delete')).toHaveCount(0);
  await expectAwaitingSource(page);

  await clickAlignmentPoint(page, 'alignment-add-point-eosin', { x: 0.24, y: 0.48 });
  await expect(page.getByTestId('alignment-add-point-eosin').locator('svg circle')).toHaveCount(1);
  await expect(page.getByTestId('alignment-add-point-he').locator('svg circle')).toHaveCount(0);
  await expect(page.getByTestId('alignment-pair-count-badge')).toContainText('Pairs 0 / 15');

  await page.getByTestId('alignment-add-point-eosin').locator('svg circle').nth(0).click();
  await expect(page.getByTestId('alignment-pair-count-badge')).toContainText('Pairs 0 / 15');

  await clickAlignmentPoint(page, 'alignment-add-point-he', { x: 0.32, y: 0.88 });
  await expect(page.getByTestId('alignment-pair-count-badge')).toContainText('Pairs 1 / 15');
  await expectAwaitingSource(page);
});

test('alignment uses focused HE asset instead of the original H&E upload', async ({ page }) => {
  await createProject(page, `task5-focused-align-${Date.now()}`);
  const { focusedHeDataUrl, originalHeDataUrl } = await seedFocusedHeConsumerState(page, 'alignment');

  await page.reload();
  await expect(page.getByTestId('alignment-add-point-he').locator('img')).toBeVisible();

  const movingImageSrc = await page.getByTestId('alignment-add-point-he').locator('img').getAttribute('src');
  expect(movingImageSrc).toBe(focusedHeDataUrl);
  expect(movingImageSrc).not.toBe(originalHeDataUrl);
});

test('crop generation uses focused HE asset instead of the original H&E upload', async ({ page }) => {
  await createProject(page, `task5-focused-crop-${Date.now()}`);
  await seedFocusedHeConsumerState(page, 'cropQc');

  await page.reload();
  await page.getByTestId('cropqc-run').click();
  await page.getByRole('tab', { name: 'Overlay opacity' }).click();
  const heCropPreview = page.getByAltText('Warped HE crop preview');
  await expect(heCropPreview).toBeVisible({ timeout: 180_000 });

  const pixel = await sampleImagePixel(heCropPreview, 0.25, 0.25);
  expect(pixel.r).toBeGreaterThan(180);
  expect(pixel.g).toBeLessThan(120);
  expect(pixel.b).toBeLessThan(120);
});

test('focused HE pair-point solve lands the warped crop in the correct eosin region', async ({ page }) => {
  await createProject(page, `task5-focused-solve-${Date.now()}`);
  const seededScenario = await seedFocusedHeSolveScenario(page);

  await page.reload();
  await expect(page.getByTestId('alignment-runtime-status-badge')).toContainText(/ready/i, { timeout: 180_000 });
  await expect(page.getByTestId('alignment-pair-count-badge')).toContainText(`Pairs ${seededScenario.pairCount} / 15`);
  await page.getByTestId('alignment-run-solve').click();
  await expect(page.getByTestId('cropqc-run')).toBeVisible();
  await expect(page.getByTestId('preprocess-step-crop')).toBeEnabled();
  await page.getByTestId('cropqc-run').click();
  await page.getByRole('tab', { name: 'Overlay opacity' }).click();
  const heCropPreview = page.getByAltText('Warped HE crop preview');
  await expect(heCropPreview).toBeVisible({ timeout: 180_000 });

  const topLeft = await sampleImagePixel(heCropPreview, 0.15, 0.15);
  const center = await sampleImagePixel(heCropPreview, 0.5, 0.5);
  const bottomRight = await sampleImagePixel(heCropPreview, 0.85, 0.85);

  expect(topLeft.g).toBeGreaterThan(150);
  expect(topLeft.r).toBeLessThan(120);
  expect(center.r).toBeGreaterThan(180);
  expect(center.g).toBeLessThan(120);
  expect(center.b).toBeLessThan(120);
  expect(bottomRight.b).toBeGreaterThan(150);
  expect(bottomRight.r).toBeLessThan(140);
});

test('cropqc feature matches preview is generated from accepted alignment', async ({ page }) => {
  await page.setContent('<!DOCTYPE html><html><body></body></html>');

  const controlPoints = [
    buildFocusedCropPoint('pair-1', 0.18, 0.24),
    buildFocusedCropPoint('pair-2', 0.52, 0.46),
    buildFocusedCropPoint('pair-3', 0.78, 0.72),
  ];

  const matchedMaskResult = await runCropQcHarness(page, {
    controlPoints,
    inlierMask: [true, false, true],
  });
  const matchedMaskRepeat = await runCropQcHarness(page, {
    controlPoints,
    inlierMask: [true, false, true],
  });
  const explicitFilteredResult = await runCropQcHarness(page, {
    controlPoints: [controlPoints[0], controlPoints[2]],
    inlierMask: null,
  });
  const fallbackMaskResult = await runCropQcHarness(page, {
    controlPoints,
    inlierMask: [true, false],
  });
  const explicitAllResult = await runCropQcHarness(page, {
    controlPoints,
    inlierMask: null,
  });
  const blankResult = await runCropQcHarness(page, {
    controlPoints: [],
    inlierMask: null,
  });

  expect(matchedMaskResult.featureMatchesDataUrl).toMatch(/^data:image\/png;base64,/);
  expect(matchedMaskResult.featureMatchesPreviewDataUrl).toBe(matchedMaskResult.featureMatchesDataUrl);
  expect(matchedMaskResult.featureMatchesSize).not.toBeNull();
  if (!matchedMaskResult.featureMatchesSize) {
    throw new Error('Expected feature matches preview dimensions');
  }

  expect(matchedMaskResult.featureMatchesSize.width).toBeGreaterThan(matchedMaskResult.cropWidth * 2);
  expect(matchedMaskResult.featureMatchesSize.height).toBe(matchedMaskResult.cropHeight);
  expect(matchedMaskResult.featureMatchesDataUrl).toBe(matchedMaskRepeat.featureMatchesDataUrl);
  expect(matchedMaskResult.featureMatchesDataUrl).toBe(explicitFilteredResult.featureMatchesDataUrl);
  expect(fallbackMaskResult.featureMatchesDataUrl).toBe(explicitAllResult.featureMatchesDataUrl);
  expect(matchedMaskResult.featureMatchesDataUrl).not.toBe(blankResult.featureMatchesDataUrl);
});

test('workspace stores cropqc feature matches preview after generation', async ({ page }) => {
  await createProject(page, `task5-cropqc-workspace-store-${Date.now()}`);
  await seedCompletedDownstreamState(page);

  const preprocessId = await getCurrentPreprocessId(page);
  await seedLegacyFeatureMatchesFallbackState(page, preprocessId);

  await page.reload();
  await expect(page.getByTestId('he-focus-stage-rotate-right-90')).toBeVisible();
  await page.getByTestId('preprocess-step-crop').click();
  await page.getByTestId('cropqc-run').click();
  await expect(page.getByTestId('cropqc-dimensions')).not.toHaveText('Not generated');

  const state = await readFeatureMatchesStorageState(page, preprocessId);
  expect(state.projectExists).toBe(true);
  expect(state.derivedKind).toBe('blob');
  expect(state.derivedSize).toBeGreaterThan(0);
  expect(state.metaAlias).toBeNull();
  expect(state.metaNested).toBeNull();
});

test('feature matches preview renders in cropqc after generation', async ({ page }) => {
  await createProject(page, `task6-cropqc-feature-matches-ui-${Date.now()}`);
  await seedCompletedDownstreamState(page);

  await page.reload();
  await expect(page.getByTestId('he-focus-stage-rotate-right-90')).toBeVisible();
  await page.getByTestId('preprocess-step-crop').click();
  await page.getByTestId('cropqc-run').click();
  await expect(page.getByTestId('cropqc-dimensions')).not.toHaveText('Not generated');
  await page.getByRole('tab', { name: 'Feature matches' }).click();

  const preview = page.getByTestId('cropqc-feature-matches-canvas');
  await expect(preview).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Feature matches' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByAltText('QC feature matches preview')).toBeVisible();
  await expect(page.getByText('Feature-match preview appears after crop generation.')).toHaveCount(0);
});

test('rerunning cropqc refreshes feature matches preview', async ({ page }) => {
  await createProject(page, `task5-cropqc-workspace-refresh-${Date.now()}`);
  await seedCompletedDownstreamState(page);

  const preprocessId = await getCurrentPreprocessId(page);

  await page.reload();
  await expect(page.getByTestId('he-focus-stage-rotate-right-90')).toBeVisible();
  await page.getByTestId('preprocess-step-crop').click();
  await page.getByTestId('cropqc-run').click();

  const firstState = await readFeatureMatchesStorageState(page, preprocessId);
  expect(firstState.derivedKind).toBe('blob');
  expect(firstState.derivedSize).toBeGreaterThan(0);
  const firstPreview = firstState.derivedDataUrl;

  await page.getByTestId('preprocess-step-align').click();
  await page.getByTestId('alignment-reset').click();
  const refreshedPoints = [
    { x: 0.24, y: 0.48 },
    { x: 0.36, y: 0.52 },
    { x: 0.48, y: 0.58 },
    { x: 0.62, y: 0.64 },
    { x: 0.28, y: 0.72 },
    { x: 0.4, y: 0.78 },
    { x: 0.54, y: 0.84 },
    { x: 0.68, y: 0.56 },
    { x: 0.58, y: 0.72 },
  ];

  for (const point of refreshedPoints) {
    await clickAlignmentPoint(page, 'alignment-add-point-eosin', point);
    await clickAlignmentPoint(page, 'alignment-add-point-he', point);
  }

  await expect(page.getByTestId('alignment-pair-count-badge')).toContainText('Pairs 9 / 15');
  await page.getByTestId('alignment-run-solve').click();
  await expect(page.getByTestId('cropqc-run')).toBeVisible();
  await expect(page.getByTestId('preprocess-step-crop')).toBeEnabled();
  await page.getByTestId('cropqc-run').click();
  await expect(page.getByTestId('autosave-status')).toContainText(/saved/i, { timeout: 15_000 });

  const refreshedState = await readFeatureMatchesStorageState(page, preprocessId);
  expect(refreshedState.derivedKind).toBe('blob');
  expect(refreshedState.derivedSize).toBeGreaterThan(0);
  expect(refreshedState.derivedDataUrl).not.toBe(firstPreview);
  expect(refreshedState.metaAlias).toBeNull();
  expect(refreshedState.metaNested).toBeNull();
});

test('cropqc feature matches preview skips off-crop pairs', async ({ page }) => {
  await page.setContent('<!DOCTYPE html><html><body></body></html>');

  const offCropResult = await runCropQcHarness(page, {
    controlPoints: [
      {
        id: 'off-crop-1',
        source: { x: 0.04, y: 0.05 },
        target: { x: 0.18, y: 0.24 },
      },
      {
        id: 'off-crop-2',
        source: { x: 0.92, y: 0.9 },
        target: { x: 0.78, y: 0.72 },
      },
    ],
    inlierMask: [true, true],
  });
  const blankResult = await runCropQcHarness(page, {
    controlPoints: [],
    inlierMask: null,
  });

  expect(offCropResult.featureMatchesDataUrl).toMatch(/^data:image\/png;base64,/);
  expect(offCropResult.featureMatchesPreviewDataUrl).toBe(offCropResult.featureMatchesDataUrl);
  expect(offCropResult.featureMatchesSize).not.toBeNull();
  if (!offCropResult.featureMatchesSize) {
    throw new Error('Expected feature matches preview dimensions for off-crop pairs');
  }

  expect(offCropResult.featureMatchesSize.width).toBeGreaterThan(offCropResult.cropWidth * 2);
  expect(offCropResult.featureMatchesSize.height).toBe(offCropResult.cropHeight);
  expect(offCropResult.featureMatchesDataUrl).toBe(blankResult.featureMatchesDataUrl);
});

test('changing HE Focus clears alignment solve state and crop outputs through invalidation', async ({ page }) => {
  await createProject(page, `task5-hefocus-invalidation-${Date.now()}`);
  await seedCompletedDownstreamState(page);

  await page.reload();
  await expect(page.getByTestId('he-focus-stage-rotate-right-90')).toBeVisible();
  await page.getByTestId('he-focus-stage-rotate-right-90').click();

  await page.waitForFunction(({ preprocessId, preprocessStorageKey }) => {
    const raw = window.localStorage.getItem(preprocessStorageKey);
    if (!raw) return false;
    const projects = JSON.parse(raw) as Array<Record<string, unknown>>;
    const project = projects.find((entry) => entry.id === preprocessId);
    if (!project || typeof project.alignment !== 'object' || project.alignment === null) {
      return false;
    }

    const alignment = project.alignment as Record<string, unknown>;
    const cropQc = project.cropQc as Record<string, unknown>;
    const controlPoints = Array.isArray(alignment.controlPoints)
      ? alignment.controlPoints.length
      : -1;

    return alignment.status === 'stale'
      && alignment.affineMatrix === null
      && controlPoints === 0
      && cropQc.status === 'stale'
      && cropQc.previewDataUrl === null;
  }, {
    preprocessId: await getCurrentPreprocessId(page),
    preprocessStorageKey: PREPROCESS_STORAGE_KEY,
  });
});

test('feature matches invalidation clears stale cropqc output', async ({ page }) => {
  await createProject(page, `task1-feature-matches-invalidation-${Date.now()}`);
  await seedCompletedDownstreamState(page);

  await page.reload();
  await expect(page.getByTestId('he-focus-stage-rotate-right-90')).toBeVisible();
  await page.getByTestId('he-focus-stage-rotate-right-90').click();

  await page.waitForFunction(({ preprocessId, preprocessStorageKey }) => {
    const raw = window.localStorage.getItem(preprocessStorageKey);
    if (!raw) return false;
    const projects = JSON.parse(raw) as Array<Record<string, unknown>>;
    const project = projects.find((entry) => entry.id === preprocessId);
    if (!project || typeof project.cropQc !== 'object' || project.cropQc === null) {
      return false;
    }

    const cropQc = project.cropQc as Record<string, unknown>;

    return cropQc.status === 'stale'
      && cropQc.previewDataUrl === null;
  }, {
    preprocessId: await getCurrentPreprocessId(page),
    preprocessStorageKey: PREPROCESS_STORAGE_KEY,
  });

  const state = await page.evaluate(({ preprocessId, preprocessStorageKey }) => {
    const raw = window.localStorage.getItem(preprocessStorageKey);
    if (!raw) throw new Error('No preprocess storage payload found');
    const projects = JSON.parse(raw) as Array<Record<string, unknown>>;
    const project = projects.find((entry) => entry.id === preprocessId);
    if (!project || typeof project.cropQc !== 'object' || project.cropQc === null) {
      throw new Error('Missing cropQc state');
    }

    const cropQc = project.cropQc as Record<string, unknown>;
    const featureMatchesPreview = cropQc.featureMatchesPreview as Record<string, unknown> | undefined;

    return {
      featureMatchesPreviewDataUrl: cropQc.featureMatchesPreviewDataUrl,
      featureMatchesPreviewDataUrlNested: featureMatchesPreview?.dataUrl ?? null,
    };
  }, {
    preprocessId: await getCurrentPreprocessId(page),
    preprocessStorageKey: PREPROCESS_STORAGE_KEY,
  });

  expect(state.featureMatchesPreviewDataUrl).toBeNull();
  expect(state.featureMatchesPreviewDataUrlNested).toBeNull();
});

test('legacy cropqc projects tolerate missing feature matches preview field', async ({ page }) => {
  const projectName = `task3-legacy-feature-matches-${Date.now()}`;
  const savedProjectName = `${projectName}-saved`;
  await createProject(page, projectName);
  await seedCompletedDownstreamState(page);

  const preprocessId = await getCurrentPreprocessId(page);
  await stripLegacyFeatureMatchesPreviewFields(page, preprocessId);

  await page.reload();
  await expect(page.getByTestId('he-focus-stage-rotate-right-90')).toBeVisible();
  await page.getByRole('heading', { name: /task3-legacy-feature-matches-/ }).click();
  await page.getByTestId('project-name-input').fill(savedProjectName);
  await page.getByTestId('project-name-input').press('Enter');
  await expect(page.getByTestId('autosave-status')).toContainText(/saved/i, { timeout: 15_000 });

  const state = await page.evaluate(({ preprocessId, preprocessStorageKey }) => {
    const raw = window.localStorage.getItem(preprocessStorageKey);
    if (!raw) return null;

    const projects = JSON.parse(raw) as Array<Record<string, unknown>>;
    const project = projects.find((entry) => entry.id === preprocessId);
    if (!project || typeof project.cropQc !== 'object' || project.cropQc === null) {
      return null;
    }

    const cropQc = project.cropQc as Record<string, unknown>;
    const featureMatchesPreview = cropQc.featureMatchesPreview as Record<string, unknown> | undefined;

    return {
      hasAlias: Object.hasOwn(cropQc, 'featureMatchesPreviewDataUrl'),
      aliasValue: cropQc.featureMatchesPreviewDataUrl,
      hasNested: Object.hasOwn(cropQc, 'featureMatchesPreview'),
      nestedValue: featureMatchesPreview?.dataUrl ?? null,
    };
  }, {
    preprocessId,
    preprocessStorageKey: PREPROCESS_STORAGE_KEY,
  });

  expect(state).toEqual({
    hasAlias: true,
    aliasValue: null,
    hasNested: true,
    nestedValue: null,
  });
});

test('feature matches preview rehydrates from storage', async ({ page }) => {
  const projectName = `task2-feature-matches-storage-${Date.now()}`;
  const firstSavedName = `${projectName}-saved-1`;
  const secondSavedName = `${projectName}-saved-2`;
  await createProject(page, projectName);
  await seedCompletedDownstreamState(page);

  const preprocessId = await getCurrentPreprocessId(page);

  await page.reload();
  await expect(page.getByTestId('he-focus-stage-rotate-right-90')).toBeVisible();
  await page.getByRole('heading', { name: projectName }).click();
  await page.getByTestId('project-name-input').fill(firstSavedName);
  await page.getByTestId('project-name-input').press('Enter');
  await expect(page.getByTestId('autosave-status')).toContainText(/saved/i, { timeout: 15_000 });

  const firstSaveState = await readFeatureMatchesStorageState(page, preprocessId);
  expect(firstSaveState.projectExists).toBe(true);
  expect(firstSaveState.derivedKind).toBe('blob');
  expect(firstSaveState.derivedSize).toBeGreaterThan(0);
  expect(firstSaveState.metaAlias).toBeNull();
  expect(firstSaveState.metaNested).toBeNull();

  const legacyFallbackState = await seedLegacyFeatureMatchesFallbackState(page, preprocessId);
  expect(legacyFallbackState.aliasDataUrl).not.toBe(legacyFallbackState.nestedDataUrl);

  await page.reload();
  await expect(page.getByTestId('he-focus-stage-rotate-right-90')).toBeVisible();
  await page.getByRole('heading', { name: firstSavedName }).click();
  await page.getByTestId('project-name-input').fill(secondSavedName);
  await page.getByTestId('project-name-input').press('Enter');
  await expect(page.getByTestId('autosave-status')).toContainText(/saved/i, { timeout: 15_000 });

  const rehydratedState = await readFeatureMatchesStorageState(page, preprocessId);
  expect(rehydratedState.projectExists).toBe(true);
  expect(rehydratedState.derivedKind).toBe('blob');
  expect(rehydratedState.derivedSize).toBeGreaterThan(0);
  expect(rehydratedState.metaAlias).toBeNull();
  expect(rehydratedState.metaNested).toBeNull();
  expect(rehydratedState.derivedDataUrl).toBe(legacyFallbackState.aliasDataUrl);
  expect(rehydratedState.derivedDataUrl).not.toBe(legacyFallbackState.nestedDataUrl);
});

test('deleting preprocess project removes feature matches preview blob', async ({ page }) => {
  const projectName = `task2-feature-matches-delete-${Date.now()}`;
  const savedProjectName = `${projectName}-saved`;
  await createProject(page, projectName);
  await seedCompletedDownstreamState(page);

  const preprocessId = await getCurrentPreprocessId(page);

  await page.reload();
  await expect(page.getByTestId('he-focus-stage-rotate-right-90')).toBeVisible();
  await page.getByRole('heading', { name: projectName }).click();
  await page.getByTestId('project-name-input').fill(savedProjectName);
  await page.getByTestId('project-name-input').press('Enter');
  await expect(page.getByTestId('autosave-status')).toContainText(/saved/i, { timeout: 15_000 });

  const savedState = await readFeatureMatchesStorageState(page, preprocessId);
  expect(savedState.derivedKind).toBe('blob');
  expect(savedState.derivedSize).toBeGreaterThan(0);

  await page.goto('/preprocess');
  await expect(page.getByTestId('preprocess-project-list')).toBeVisible();
  await page.getByRole('button', { name: `Delete ${savedProjectName}` }).click();
  await expect(page.getByRole('heading', { name: savedProjectName })).toHaveCount(0);

  const deletedState = await readFeatureMatchesStorageState(page, preprocessId);
  expect(deletedState.projectExists).toBe(false);
  expect(deletedState.derivedKind).toBeNull();
  expect(deletedState.derivedSize).toBe(0);
});

test('selected pair exposes contextual reposition and delete actions', async ({ page }) => {
  await createProject(page, `task15-selected-pair-${Date.now()}`);
  await uploadAlignmentImages(page);

  await clickAlignmentPoint(page, 'alignment-add-point-eosin', { x: 0.32, y: 0.88 });
  await clickAlignmentPoint(page, 'alignment-add-point-he', { x: 0.32, y: 0.88 });

  const beforeTarget = await getAlignmentCirclePosition(page, 'alignment-add-point-he');
  await page.getByTestId('alignment-add-point-he').locator('svg circle').nth(0).click();

  await expect(page.getByTestId('alignment-selected-pair-badge')).toContainText(/pair/i);
  await expect(page.getByTestId('alignment-select-reposition-target')).toBeVisible();
  await expect(page.getByTestId('alignment-select-delete-pair')).toBeVisible();

  await page.getByTestId('alignment-select-reposition-target').click();
  await expect(page.getByTestId('alignment-workflow-instruction')).toContainText(/new h&e landmark position/i);

  await clickAlignmentPoint(page, 'alignment-add-point-he', { x: 0.56, y: 0.88 });

  const afterTarget = await getAlignmentCirclePosition(page, 'alignment-add-point-he');
  expect(
    afterTarget.cx !== beforeTarget.cx || afterTarget.cy !== beforeTarget.cy,
  ).toBe(true);
  await expect(page.getByTestId('alignment-pair-count-badge')).toContainText('Pairs 1 / 15');
  await expectAwaitingSource(page);

  await page.getByTestId('alignment-add-point-eosin').locator('svg circle').nth(0).click();
  await page.getByTestId('alignment-select-delete-pair').click();

  await expect(page.getByTestId('alignment-pair-count-badge')).toContainText('Pairs 0 / 15');
  await expect(page.getByTestId('alignment-add-point-eosin').locator('svg circle')).toHaveCount(0);
  await expect(page.getByTestId('alignment-add-point-he').locator('svg circle')).toHaveCount(0);
});

test('workspace edits persist only after step transition save', async ({ page }) => {
  const initialName = `task12-save-initial-${Date.now()}`;
  const deferredName = `task12-save-deferred-${Date.now()}`;
  const persistedName = `task12-save-persisted-${Date.now()}`;

  await createProject(page, initialName);

  await page.getByRole('heading', { name: initialName }).click();
  const nameInput = page.getByTestId('project-name-input');
  await nameInput.fill(deferredName);
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.getByRole('heading', { name: initialName })).toBeVisible();

  await page.getByRole('heading', { name: initialName }).click();
  await page.getByTestId('project-name-input').fill(persistedName);
  await page.getByTestId('preprocess-step-localize').click();
  await expect(page.getByTestId('autosave-status')).toContainText(/saved|saving/i);
  await page.waitForTimeout(1200);
  await page.reload();

  await expect(page.getByRole('heading', { name: persistedName })).toBeVisible();
  await expect(page.getByText('No eosin image loaded')).toBeVisible();
});

test('localize transform exposes zoom control', async ({ page }) => {
  await createProject(page, `task12-localize-zoom-${Date.now()}`);
  await page.getByTestId('preprocess-step-source-assets').click();
  const eosinPath = path.join(process.cwd(), 'tests/fixtures/preprocess/eosin.png');
  await page.locator('input[type="file"]').first().setInputFiles(eosinPath);
  await page.getByTestId('preprocess-step-localize').click();
  await expect(page.getByTestId('localize-stage-controls')).toBeVisible();
  await expect(page.getByTestId('localize-stage-zoom-in')).toBeVisible();
});

test('align exposes floating H&E transform controls and wheel zoom does not scroll page', async ({ page }) => {
  await createProject(page, `task15-align-he-controls-${Date.now()}`);
  await uploadAlignmentImages(page);
  await expect(page.getByText(/Landmark alignment can now target this image/i)).toBeHidden({ timeout: 10_000 });

  await expect(page.getByTestId('alignment-reference-view-controls')).toBeVisible();
  await expect(page.getByTestId('alignment-moving-view-controls')).toBeVisible();
  await expect(page.getByTestId('alignment-he-rotation-slider')).toBeVisible();
  await expect(page.getByTestId('alignment-he-scale-slider')).toBeVisible();
  await expect(page.getByTestId('alignment-he-flip-horizontal')).toBeVisible();

  const beforeScroll = await page.evaluate(() => window.scrollY);
  const canvas = page.getByTestId('alignment-add-point-eosin');
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await page.mouse.move((canvasBox?.x ?? 0) + 220, (canvasBox?.y ?? 0) + 220);
  await page.mouse.wheel(0, 600);
  const afterScroll = await page.evaluate(() => window.scrollY);
  expect(afterScroll).toBe(beforeScroll);
});

test('dragging alignment background pans one canvas independently', async ({ page }) => {
  await createProject(page, `task12-align-pan-${Date.now()}`);
  await uploadAlignmentImages(page);

  await expect(page.getByText(/Landmark alignment can now target this image/i)).toBeHidden({ timeout: 10_000 });

  const before = await getAlignmentImageBox(page, 'alignment-add-point-eosin');
  const canvas = page.getByTestId('alignment-add-point-eosin');
  await canvas.scrollIntoViewIfNeeded();
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();

  await page.mouse.move((canvasBox?.x ?? 0) + (canvasBox?.width ?? 0) * 0.45, (canvasBox?.y ?? 0) + (canvasBox?.height ?? 0) * 0.45);
  await page.mouse.down();
  await page.mouse.move((canvasBox?.x ?? 0) + (canvasBox?.width ?? 0) * 0.65, (canvasBox?.y ?? 0) + (canvasBox?.height ?? 0) * 0.6, { steps: 12 });
  await page.mouse.up();

  const after = await getAlignmentImageBox(page, 'alignment-add-point-eosin');
  expect(after.left).not.toBe(before.left);
});

test('repeated solve/reset stays stable and crop step remains reachable', async ({ page }) => {
  test.setTimeout(60_000);
  await createProject(page, `task12-hardening-cycles-${Date.now()}`);
  await uploadAlignmentImages(page);

  for (let cycle = 0; cycle < 5; cycle += 1) {
    await addTenIdentityPairs(page);
    await page.getByTestId('alignment-run-solve').click();
    await expect(page.getByTestId('cropqc-run')).toBeVisible();
    await page.getByTestId('preprocess-step-align').click();
    await expect(page.getByTestId('alignment-status')).toContainText(/Accepted|Rejected/i);
    await page.getByTestId('alignment-reset').click();
    await expect(page.getByTestId('alignment-pair-count-badge')).toContainText('Pairs 0 / 15');
  }

  await addTenIdentityPairs(page);
  await page.getByTestId('alignment-run-solve').click();
  await expect(page.getByTestId('cropqc-run')).toBeVisible();
  await expect(page.getByTestId('preprocess-step-crop')).toBeEnabled();

  await page.getByTestId('preprocess-step-align').click();
  await expect(page.getByTestId('alignment-status')).toContainText(/Accepted/i);

  await page.screenshot({
    path: path.join(process.cwd(), '.sisyphus/evidence/task-12-hardening-happy.png'),
    fullPage: true,
  });
});

test('clustered landmarks stay blocked after solve and keep crop disabled', async ({ page }) => {
  await createProject(page, `task12-clustered-coverage-${Date.now()}`);
  await uploadAlignmentImages(page);

  await addTenClusteredPairs(page);
  await expect(page.getByTestId('alignment-distribution-warning')).toBeVisible();

  await page.getByTestId('alignment-run-solve').click();

  await expect(page.getByTestId('alignment-status')).toContainText(/Rejected|Not solved/i);
  await expect(page.getByTestId('alignment-status')).toHaveAttribute('data-solve-accepted', 'false');
  await expect(page.getByTestId('preprocess-step-crop')).toBeDisabled();
});

test('solve alignment uses all points by default and opens crop qc', async ({ page }) => {
  await createProject(page, `task16-dangerous-recompute-${Date.now()}`);
  await seedDangerousContinueScenario(page, 'rejected');

  await page.reload();
  await expect(page.getByTestId('alignment-workflow-overlay')).toBeVisible();
  await expect(page.getByTestId('alignment-status')).toContainText(/Rejected/i);
  await expect(page.getByTestId('alignment-accept-rejected-solve')).toHaveCount(0);
  await expect(page.getByTestId('alignment-recompute-all-points')).toHaveCount(0);

  await page.getByTestId('alignment-run-solve').click();
  await expect(page.getByTestId('cropqc-run')).toBeVisible();
  await expect(page.getByTestId('preprocess-step-crop')).toBeEnabled();

  const solvedAlignment = await page.evaluate(({ preprocessId, preprocessStorageKey }) => {
    const raw = window.localStorage.getItem(preprocessStorageKey);
    if (!raw) throw new Error('No preprocess storage payload found');

    const projects = JSON.parse(raw) as Array<Record<string, unknown>>;
    const project = projects.find((entry) => entry.id === preprocessId);
    if (!project || typeof project.alignment !== 'object' || project.alignment === null) {
      throw new Error('Missing alignment state');
    }

    const alignment = project.alignment as Record<string, unknown>;
    return {
      status: alignment.status,
      solveAccepted: alignment.solveAccepted,
      inlierRatio: alignment.inlierRatio,
      affineMatrix: JSON.stringify(alignment.affineMatrix),
    };
  }, {
    preprocessId: await getCurrentPreprocessId(page),
    preprocessStorageKey: PREPROCESS_STORAGE_KEY,
  });

  expect(solvedAlignment.status).toBe('complete');
  expect(solvedAlignment.solveAccepted).toBe(true);
  expect(solvedAlignment.inlierRatio).not.toBeNull();
  expect(solvedAlignment.affineMatrix).toBeTruthy();
});

test('accepted solve with outliers no longer exposes recovery actions', async ({ page }) => {
  await createProject(page, `task16-dangerous-outliers-${Date.now()}`);
  await seedDangerousContinueScenario(page, 'accepted-with-outliers');

  await page.reload();
  await expect(page.getByTestId('alignment-workflow-overlay')).toBeVisible();
  await expect(page.getByTestId('alignment-status')).toContainText(/Accepted/i);
  await expect(page.getByTestId('alignment-continue-current-solve')).toHaveCount(0);
  await expect(page.getByTestId('alignment-recompute-all-points')).toHaveCount(0);
});

test('oversized input and synthetic quota failure surface recoverable errors', async ({ page }) => {
  await createProject(page, `task12-hardening-errors-${Date.now()}`);

  const oversizedPath = path.join(process.cwd(), 'test-results', `oversized-${Date.now()}.png`);
  await fs.mkdir(path.dirname(oversizedPath), { recursive: true });
  await fs.writeFile(oversizedPath, '');
  await fs.truncate(oversizedPath, 512 * 1024 * 1024 + 1);
  await page.getByTestId('preprocess-step-source-assets').click();
  await page.locator('input[type="file"]').first().setInputFiles(oversizedPath);

  await expect(page.getByText(/exceeds/i)).toBeVisible();

  const eosinPath = path.join(process.cwd(), 'tests/fixtures/preprocess/eosin.png');
  await page.locator('input[type="file"]').first().setInputFiles(eosinPath);
  await page.getByTestId('preprocess-step-localize').click();
  await page.getByTestId('localize-stage-reset').click();
  await expect(page.getByTestId('preprocess-step-he-focus')).toBeEnabled();
  await expect(page.getByTestId('preprocess-step-align')).toBeDisabled();

  await page.getByRole('heading', { name: /task12-hardening-errors-/i }).click();
  const nameInput = page.getByTestId('project-name-input');
  await nameInput.fill(`task12-hardening-quota-${Date.now()}`);
  await page.evaluate(() => {
    Object.defineProperty(window, '__PREPROCESS_TEST_FORCE_QUOTA__', {
      configurable: true,
      get: () => true,
      set: () => {},
    });
  });
  await nameInput.blur();

  await expect(page.getByTestId('autosave-status')).toContainText('error');
  await expect(page.getByText('save failed — last saved snapshot preserved')).toBeVisible();

  await page.getByRole('button', { name: /Back to preprocess projects/i }).click();
  await expect(page.getByTestId('preprocess-project-list')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open workspace' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Open workspace' }).first().click();
  await expect(page).toHaveURL(/preprocess_id=/);

  await page.screenshot({
    path: path.join(process.cwd(), '.sisyphus/evidence/task-12-hardening-error.png'),
    fullPage: true,
  });

  await fs.rm(oversizedPath, { force: true });

  await page.evaluate(() => {
    delete (window as unknown as { __PREPROCESS_TEST_FORCE_QUOTA__?: boolean }).__PREPROCESS_TEST_FORCE_QUOTA__;
  });

});
