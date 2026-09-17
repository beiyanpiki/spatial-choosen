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

type OpenCvModule = Partial<OpenCvRuntime> & {
  calledRun?: boolean;
  locateFile?: (path: string) => string;
  onAbort?: (reason: unknown) => void;
  onRuntimeInitialized?: () => void;
  then?: (onFulfilled: (value: unknown) => unknown) => unknown;
  wasmBinary?: ArrayBuffer | Uint8Array;
};

type OpenCvGlobal = {
  cv?: OpenCvModule;
  Module?: OpenCvModule;
  __opencvScriptPromise?: Promise<void>;
  __opencvLoadError?: Error;
};

const OPENCV_SCRIPT_URL = '/vendor/opencv/opencv.js';
const OPENCV_WASM_URL = '/vendor/opencv/opencv.wasm';
const OPENCV_MAX_ATTEMPTS = 2;
const OPENCV_RESOURCE_TIMEOUT_MS = 30_000;
const OPENCV_RUNTIME_TIMEOUT_MS = 60_000;

function isReady(cv: unknown): cv is OpenCvRuntime {
  if (!cv || typeof cv !== 'object') return false;
  const candidate = cv as Partial<OpenCvRuntime>;
  return typeof candidate.estimateAffine2D === 'function'
    && typeof candidate.warpAffine === 'function'
    && typeof candidate.matFromArray === 'function'
    && typeof candidate.matFromImageData === 'function';
}

const toError = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error;
  const detail = typeof error === 'string' ? error : String(error ?? '');
  return new Error(detail ? `${fallback}: ${detail}` : fallback);
};

const clearAttemptState = (globalObject: OpenCvGlobal) => {
  document
    .querySelectorAll<HTMLScriptElement>('script[data-opencv-runtime="true"]')
    .forEach((script) => script.remove());
  globalObject.cv = undefined;
  globalObject.Module = undefined;
};

const waitBeforeRetry = () => new Promise<void>((resolve) => {
  window.setTimeout(resolve, 250);
});

const fetchWasmBinary = async (): Promise<ArrayBuffer> => {
  const controller = new AbortController();
  const timeoutTimer = window.setTimeout(
    () => controller.abort(),
    OPENCV_RESOURCE_TIMEOUT_MS,
  );

  try {
    const response = await fetch(OPENCV_WASM_URL, {
      cache: 'force-cache',
      credentials: 'same-origin',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to load OpenCV WASM (${response.status})`);
    }

    const binary = await response.arrayBuffer();
    if (binary.byteLength < 8) {
      throw new Error('OpenCV WASM response was empty or incomplete');
    }
    return binary;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('OpenCV WASM download timed out');
    }
    throw toError(error, 'Failed to load OpenCV WASM');
  } finally {
    window.clearTimeout(timeoutTimer);
  }
};

type RuntimeWaiter = {
  cancel: (error: Error) => void;
  promise: Promise<void>;
};

const createRuntimeWaiter = (
  globalObject: OpenCvGlobal,
  wasmBinary: ArrayBuffer,
): RuntimeWaiter => {
  let settled = false;
  let pollTimer: number | null = null;
  let timeoutTimer: number | null = null;
  let resolvePromise: () => void = () => undefined;
  let rejectPromise: (error: Error) => void = () => undefined;

  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const finish = (error?: Error) => {
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
    if (error) {
      rejectPromise(error);
    } else {
      resolvePromise();
    }
  };

  const moduleObject: OpenCvModule = {
    locateFile: (path: string) => (
      path.endsWith('.wasm') ? OPENCV_WASM_URL : `/vendor/opencv/${path}`
    ),
    wasmBinary,
    onAbort: (reason: unknown) => {
      finish(toError(reason, 'OpenCV runtime aborted'));
    },
    onRuntimeInitialized: () => {
      checkReady();
      if (!settled) window.setTimeout(checkReady, 0);
    },
  };

  const checkReady = () => {
    const runtime = isReady(globalObject.cv)
      ? globalObject.cv
      : isReady(moduleObject)
        ? moduleObject
        : null;
    if (!runtime) return;
    globalObject.cv = runtime;
    finish();
  };

  globalObject.Module = moduleObject;
  pollTimer = window.setInterval(checkReady, 100);
  timeoutTimer = window.setTimeout(() => {
    finish(new Error(
      `OpenCV runtime initialization timed out after ${OPENCV_RUNTIME_TIMEOUT_MS / 1000} seconds`,
    ));
  }, OPENCV_RUNTIME_TIMEOUT_MS);

  return {
    cancel: (error: Error) => finish(error),
    promise,
  };
};

const appendScriptTag = (): Promise<void> => new Promise((resolve, reject) => {
  const script = document.createElement('script');
  let settled = false;
  let timeoutTimer: number | null = null;

  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    script.removeEventListener('load', onLoaded);
    script.removeEventListener('error', onError);
    if (timeoutTimer !== null) {
      window.clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
    if (error) {
      reject(error);
    } else {
      resolve();
    }
  };

  const onLoaded = () => {
    script.dataset.loaded = 'true';
    finish();
  };

  const onError = () => {
    finish(new Error('Failed to load vendored OpenCV script'));
  };

  script.src = OPENCV_SCRIPT_URL;
  script.async = true;
  script.dataset.opencvRuntime = 'true';
  script.addEventListener('load', onLoaded);
  script.addEventListener('error', onError);
  timeoutTimer = window.setTimeout(() => {
    finish(new Error('OpenCV script load timed out'));
  }, OPENCV_RESOURCE_TIMEOUT_MS);
  document.head.appendChild(script);
});

const runLoadAttempt = async (globalObject: OpenCvGlobal) => {
  const wasmBinary = await fetchWasmBinary();
  const runtimeWaiter = createRuntimeWaiter(globalObject, wasmBinary);

  try {
    await Promise.all([
      appendScriptTag(),
      runtimeWaiter.promise,
    ]);
  } catch (error) {
    const loadError = toError(error, 'Failed to initialize OpenCV runtime');
    runtimeWaiter.cancel(loadError);
    throw loadError;
  }

  if (!isReady(globalObject.cv)) {
    throw new Error('OpenCV runtime was not ready after initialization');
  }

  if (globalObject.Module) {
    globalObject.Module.wasmBinary = undefined;
  }
};

const initializeOpenCv = async (globalObject: OpenCvGlobal) => {
  let lastError = new Error('Failed to initialize OpenCV runtime');

  for (let attempt = 1; attempt <= OPENCV_MAX_ATTEMPTS; attempt += 1) {
    clearAttemptState(globalObject);
    try {
      await runLoadAttempt(globalObject);
      globalObject.__opencvLoadError = undefined;
      return;
    } catch (error) {
      lastError = toError(error, 'Failed to initialize OpenCV runtime');
      clearAttemptState(globalObject);
      if (attempt < OPENCV_MAX_ATTEMPTS) {
        await waitBeforeRetry();
      }
    }
  }

  throw new Error(
    `OpenCV failed to initialize after ${OPENCV_MAX_ATTEMPTS} attempts: ${lastError.message}`,
  );
};

export async function loadOpenCv(): Promise<{ cv: OpenCvRuntime }> {
  if (typeof window === 'undefined') {
    throw new Error('OpenCV runtime can only be loaded in the browser');
  }

  const globalObject = window as typeof window & OpenCvGlobal;

  if (isReady(globalObject.cv)) {
    return { cv: globalObject.cv };
  }

  if (!globalObject.__opencvScriptPromise) {
    globalObject.__opencvScriptPromise = initializeOpenCv(globalObject).catch((error) => {
      const loadError = toError(error, 'Failed to initialize OpenCV runtime');
      globalObject.__opencvLoadError = loadError;
      globalObject.__opencvScriptPromise = undefined;
      clearAttemptState(globalObject);
      throw loadError;
    });
  }

  await globalObject.__opencvScriptPromise;

  if (!isReady(globalObject.cv)) {
    throw new Error('OpenCV runtime was not ready after initialization');
  }

  return { cv: globalObject.cv };
}

export type { OpenCvRuntime, CvMat };
