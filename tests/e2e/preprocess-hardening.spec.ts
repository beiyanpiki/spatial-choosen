import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const PREPROCESS_STORAGE_KEY = 'spatial-preprocess-projects';

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

async function seedRejectedDangerousContinueScenario(page: import('@playwright/test').Page) {
  const preprocessId = await getCurrentPreprocessId(page);

  return page.evaluate(({ preprocessId, preprocessStorageKey }) => {
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
          status: 'error',
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
            accepted: false,
          },
          solveAccepted: false,
          failureReason: 'rmse-too-high',
          transform: null,
          previewDataUrl: null,
          error: 'rmse-too-high',
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
    const cropPreviewDataUrl = makeImage(120, 120, 'rgb(220,60,60)');
    const checkerboardDataUrl = makeImage(120, 120, 'rgb(200,120,120)');
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
          qcAccepted: true,
          eosinPreviewDataUrl: eosinDataUrl,
          previewDataUrl: cropPreviewDataUrl,
          checkerboardPreviewDataUrl: checkerboardDataUrl,
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
    { x: 0.24, y: 0.48 },
    { x: 0.36, y: 0.52 },
    { x: 0.48, y: 0.58 },
    { x: 0.62, y: 0.64 },
    { x: 0.28, y: 0.72 },
    { x: 0.4, y: 0.78 },
    { x: 0.54, y: 0.84 },
    { x: 0.68, y: 0.56 },
    { x: 0.58, y: 0.72 },
    { x: 0.32, y: 0.88 },
  ];

  for (const point of points) {
    await clickAlignmentPoint(page, 'alignment-add-point-eosin', point);
    await clickAlignmentPoint(page, 'alignment-add-point-he', point);
  }

  await expect(page.getByTestId('alignment-pair-count-badge')).toContainText('Pairs 10 / 15');
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
  await expect(page.getByTestId('alignment-status')).toContainText(/Accepted/i);
  await expect(page.getByTestId('preprocess-step-crop')).toBeEnabled();

  await page.getByTestId('preprocess-step-crop').click();
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
    await expect(page.getByTestId('alignment-status')).toContainText(/Accepted|Rejected/i);
    await page.getByTestId('alignment-reset').click();
    await expect(page.getByTestId('alignment-pair-count-badge')).toContainText('Pairs 0 / 15');
  }

  await addTenIdentityPairs(page);
  await page.getByTestId('alignment-run-solve').click();
  await expect(page.getByTestId('alignment-status')).toContainText(/Accepted/i);
  await expect(page.getByTestId('preprocess-step-crop')).toBeEnabled();

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

test('rejected solve exposes separate dangerous accept and recompute actions', async ({ page }) => {
  await createProject(page, `task16-dangerous-actions-${Date.now()}`);
  await seedRejectedDangerousContinueScenario(page);

  await page.reload();
  await expect(page.getByTestId('alignment-workflow-overlay')).toBeVisible();
  await expect(page.getByTestId('alignment-status')).toContainText(/Rejected/i);

  await expect(page.getByTestId('alignment-accept-rejected-solve')).toBeVisible();
  await expect(page.getByTestId('alignment-recompute-all-points')).toBeVisible();

  await page.getByTestId('alignment-diagnostics-toggle').click();
  const rejectedMatrix = await page.getByTestId('alignment-matrix-json').textContent();
  const rejectedInlierRatio = await page.getByTestId('alignment-inlier-ratio').textContent();

  await page.getByTestId('alignment-accept-rejected-solve').click();
  await expect(page.getByTestId('alignment-status')).toContainText(/Accepted/i);
  await expect(page.getByTestId('preprocess-step-crop')).toBeEnabled();
  await expect(page.getByTestId('alignment-matrix-json')).toHaveText(rejectedMatrix ?? '');
  await expect(page.getByTestId('alignment-inlier-ratio')).toHaveText(rejectedInlierRatio ?? '');
});

test('dangerous recompute uses all points instead of the rejected inlier subset', async ({ page }) => {
  await createProject(page, `task16-dangerous-recompute-${Date.now()}`);
  await seedRejectedDangerousContinueScenario(page);

  await page.reload();
  await expect(page.getByTestId('alignment-workflow-overlay')).toBeVisible();
  await expect(page.getByTestId('alignment-status')).toContainText(/Rejected/i);

  await page.getByTestId('alignment-diagnostics-toggle').click();
  const rejectedMatrix = await page.getByTestId('alignment-matrix-json').textContent();

  await page.getByTestId('alignment-recompute-all-points').click();
  await expect(page.getByTestId('alignment-status')).toContainText(/Accepted/i);
  await expect(page.getByTestId('preprocess-step-crop')).toBeEnabled();
  await expect(page.getByTestId('alignment-inlier-ratio')).toHaveText('100.0%');
  await expect(page.getByTestId('alignment-matrix-json')).not.toHaveText(rejectedMatrix ?? '');
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
