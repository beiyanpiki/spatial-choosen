import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadOpenCv } from './loadOpenCv';

type TestOpenCvModule = {
  estimateAffine2D?: () => undefined;
  matFromArray?: () => undefined;
  matFromImageData?: () => undefined;
  onAbort?: (reason: unknown) => void;
  onRuntimeInitialized?: () => void;
  warpAffine?: () => undefined;
  wasmBinary?: ArrayBuffer | Uint8Array;
};

type TestOpenCvWindow = typeof window & {
  cv?: TestOpenCvModule;
  Module?: TestOpenCvModule;
  __opencvScriptPromise?: Promise<void>;
  __opencvLoadError?: Error;
};

const getOpenCvWindow = () => window as TestOpenCvWindow;

const completeCurrentAttempt = () => {
  const globalObject = getOpenCvWindow();
  const moduleObject = globalObject.Module;
  if (!moduleObject) throw new Error('OpenCV module was not prepared');

  Object.assign(moduleObject, {
    estimateAffine2D: () => undefined,
    matFromArray: () => undefined,
    matFromImageData: () => undefined,
    warpAffine: () => undefined,
  });
  globalObject.cv = moduleObject;

  const script = document.querySelector<HTMLScriptElement>(
    'script[data-opencv-runtime="true"]',
  );
  if (!script) throw new Error('OpenCV script was not appended');
  script.dispatchEvent(new Event('load'));
  moduleObject.onRuntimeInitialized?.();
};

const abortCurrentAttempt = (reason: string) => {
  const globalObject = getOpenCvWindow();
  const moduleObject = globalObject.Module;
  const script = document.querySelector<HTMLScriptElement>(
    'script[data-opencv-runtime="true"]',
  );
  if (!moduleObject || !script) throw new Error('OpenCV attempt was not prepared');

  script.dispatchEvent(new Event('load'));
  moduleObject.onAbort?.(reason);
};

describe('loadOpenCv', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    const globalObject = getOpenCvWindow();
    document
      .querySelectorAll('script[data-opencv-runtime="true"]')
      .forEach((script) => script.remove());
    globalObject.cv = undefined;
    globalObject.Module = undefined;
    globalObject.__opencvScriptPromise = undefined;
    globalObject.__opencvLoadError = undefined;

    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(16),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefetches WASM and resolves from the runtime callback', async () => {
    const loadPromise = loadOpenCv();

    await waitFor(() => {
      expect(
        document.querySelector('script[data-opencv-runtime="true"]'),
      ).toBeInTheDocument();
    });
    expect(getOpenCvWindow().Module?.wasmBinary).toBeInstanceOf(ArrayBuffer);

    completeCurrentAttempt();

    const result = await loadPromise;
    expect(result.cv).toBe(getOpenCvWindow().cv);
    expect(fetchMock).toHaveBeenCalledWith(
      '/vendor/opencv/opencv.wasm',
      expect.objectContaining({
        cache: 'force-cache',
        credentials: 'same-origin',
      }),
    );
    expect(getOpenCvWindow().Module?.wasmBinary).toBeUndefined();
  });

  it('clears an aborted runtime and automatically retries with a fresh script', async () => {
    const loadPromise = loadOpenCv();

    await waitFor(() => {
      expect(
        document.querySelector('script[data-opencv-runtime="true"]'),
      ).toBeInTheDocument();
    });
    const firstScript = document.querySelector<HTMLScriptElement>(
      'script[data-opencv-runtime="true"]',
    );
    abortCurrentAttempt('transient compile failure');

    await waitFor(() => {
      const nextScript = document.querySelector<HTMLScriptElement>(
        'script[data-opencv-runtime="true"]',
      );
      expect(nextScript).toBeInTheDocument();
      expect(nextScript).not.toBe(firstScript);
    });

    completeCurrentAttempt();

    await expect(loadPromise).resolves.toEqual({ cv: getOpenCvWindow().cv });
    expect(firstScript).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('allows a later call to retry after both automatic attempts abort', async () => {
    const failedLoad = loadOpenCv();

    await waitFor(() => {
      expect(
        document.querySelector('script[data-opencv-runtime="true"]'),
      ).toBeInTheDocument();
    });
    abortCurrentAttempt('first failure');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(
        document.querySelector('script[data-opencv-runtime="true"]'),
      ).toBeInTheDocument();
    });
    abortCurrentAttempt('second failure');

    await expect(failedLoad).rejects.toThrow(
      'OpenCV failed to initialize after 2 attempts',
    );
    expect(
      document.querySelector('script[data-opencv-runtime="true"]'),
    ).not.toBeInTheDocument();

    const retryLoad = loadOpenCv();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(
        document.querySelector('script[data-opencv-runtime="true"]'),
      ).toBeInTheDocument();
    });
    completeCurrentAttempt();

    await expect(retryLoad).resolves.toEqual({ cv: getOpenCvWindow().cv });
  });
});
