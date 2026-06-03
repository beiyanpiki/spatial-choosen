type CvMat = {
  rows: number;
  cols: number;
  data64F: Float64Array;
  data32F: Float32Array;
  data: Uint8Array;
  empty: () => boolean;
  delete: () => void;
};

type OpenCvRuntime = {
  Mat: new (...args: unknown[]) => CvMat;
  matFromArray: (rows: number, cols: number, type: number, data: ArrayLike<number>) => CvMat;
  estimateAffine2D: (
    from: CvMat,
    to: CvMat,
    inliers: CvMat,
    method: number,
    ransacReprojThreshold: number,
    maxIters: number,
    confidence: number,
    refineIters: number,
  ) => CvMat;
  warpAffine: (...args: unknown[]) => unknown;
  matFromImageData: (imageData: ImageData) => CvMat;
  Size: new (width: number, height: number) => unknown;
  Scalar: new (v0: number, v1?: number, v2?: number, v3?: number) => unknown;
  RANSAC: number;
  CV_64F: number;
  CV_8U: number;
  INTER_LINEAR: number;
  BORDER_CONSTANT: number;
};

type OpenCvGlobal = {
  cv?: Partial<OpenCvRuntime> & {
    onRuntimeInitialized?: () => void;
    then?: (onFulfilled: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) => Promise<unknown>;
  };
  Module?: Partial<OpenCvRuntime> & {
    locateFile?: (path: string) => string;
    onRuntimeInitialized?: () => void;
    then?: (onFulfilled: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) => Promise<unknown>;
  };
  __opencvScriptPromise?: Promise<void>;
  __opencvLoadError?: Error;
};

const OPENCV_SCRIPT_URL = '/vendor/opencv/opencv.js';
const OPENCV_WASM_URL = '/vendor/opencv/opencv.wasm';

function isReady(cv: unknown): cv is OpenCvRuntime {
  if (!cv || typeof cv !== 'object') return false;
  const candidate = cv as Partial<OpenCvRuntime>;
  return typeof candidate.estimateAffine2D === 'function'
    && typeof candidate.warpAffine === 'function'
    && typeof candidate.matFromArray === 'function'
    && typeof candidate.matFromImageData === 'function';
}

const waitForRuntime = (globalObject: OpenCvGlobal): Promise<void> => {
  const cv = globalObject.cv;
  if (isReady(cv)) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const timeoutMs = 20_000;
    let resolved = false;

    const cleanup = () => {
      resolved = true;
    };

    const fail = () => {
      if (!resolved) {
        cleanup();
        reject(new Error('OpenCV runtime initialization timed out'));
      }
    };

    const success = () => {
      if (!resolved) {
        cleanup();
        resolve();
      }
    };

    const tick = () => {
      if (resolved) return;
      if (isReady(globalObject.cv)) {
        success();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        fail();
        return;
      }
      if (!resolved) window.setTimeout(tick, 50);
    };

    const cvObj = globalObject.cv;
    if (cvObj && typeof cvObj.onRuntimeInitialized === 'function') {
      const originalCallback = cvObj.onRuntimeInitialized;
      cvObj.onRuntimeInitialized = function(this: NonNullable<OpenCvGlobal['cv']>) {
        originalCallback.call(this);
        success();
      };
    }

    tick();
  });
};

const appendScriptTag = (globalObject: OpenCvGlobal): Promise<void> => new Promise((resolve, reject) => {
  const existing = document.querySelector<HTMLScriptElement>(`script[data-opencv-runtime="true"]`);

  let settled = false;
  let pollTimer: number | null = null;
  let timeoutTimer: number | null = null;

  const finish = (callback: () => void) => {
    if (settled) return;
    settled = true;
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
    if (timeoutTimer !== null) {
      window.clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
    callback();
  };

  const onLoaded = () => {
    finish(resolve);
  };

  const onError = () => {
    finish(() => reject(new Error('Failed to load vendored OpenCV script')));
  };

  const timeoutMs = 30_000;

  const startExistingScriptGuards = (scriptElement: HTMLScriptElement) => {
    pollTimer = window.setInterval(() => {
      const state = (scriptElement as HTMLScriptElement & { readyState?: string }).readyState;
      if (scriptElement.dataset.loaded === 'true' || state === 'complete' || isReady(globalObject.cv)) {
        finish(resolve);
      }
    }, 100);

    timeoutTimer = window.setTimeout(() => {
      finish(() => reject(new Error('OpenCV script load timed out')));
    }, timeoutMs);
  };

  if (existing) {
    const existingState = (existing as HTMLScriptElement & { readyState?: string }).readyState;
    if (existing.dataset.loaded === 'true' || existingState === 'complete' || isReady(globalObject.cv)) {
      resolve();
      return;
    }

    existing.addEventListener('load', onLoaded, { once: true });
    existing.addEventListener('error', onError, { once: true });
    startExistingScriptGuards(existing);

    return;
  }

  globalObject.Module = {
    ...(globalObject.Module ?? {}),
    locateFile: (path: string) => (path.endsWith('.wasm') ? OPENCV_WASM_URL : `/vendor/opencv/${path}`),
  };

  const script = document.createElement('script');
  script.src = OPENCV_SCRIPT_URL;
  script.async = true;
  script.defer = true;
  script.dataset.opencvRuntime = 'true';
  script.addEventListener('load', () => {
    script.dataset.loaded = 'true';
    finish(resolve);
  }, { once: true });
  script.addEventListener('error', onError, { once: true });
  timeoutTimer = window.setTimeout(() => {
    finish(() => reject(new Error('OpenCV script load timed out')));
  }, timeoutMs);
  document.body.appendChild(script);
});

export async function loadOpenCv(): Promise<{ cv: OpenCvRuntime }> {
  if (typeof window === 'undefined') {
    throw new Error('OpenCV runtime can only be loaded in the browser');
  }

  const globalObject = window as typeof window & OpenCvGlobal;
  
  if (isReady(globalObject.cv)) {
    return { cv: globalObject.cv };
  }

  if (!globalObject.__opencvScriptPromise) {
    globalObject.__opencvScriptPromise = (async () => {
      try {
        await appendScriptTag(globalObject);
        await waitForRuntime(globalObject);

        if (!isReady(globalObject.cv)) {
          throw new Error('OpenCV runtime not ready after wait');
        }
      } catch (error) {
        const loadError = error instanceof Error ? error : new Error(String(error));
        globalObject.__opencvLoadError = loadError;
        globalObject.__opencvScriptPromise = undefined;
        throw loadError;
      }
    })();
  }

  await globalObject.__opencvScriptPromise;
  return { cv: globalObject.cv as OpenCvRuntime };
}

export type { OpenCvRuntime, CvMat };
