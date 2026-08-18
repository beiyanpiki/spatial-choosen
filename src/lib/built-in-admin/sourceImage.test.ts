import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PREPROCESS_WORKING_PROXY_MAX_BYTES } from './constants';
import { buildSourceImage, createWorkingProxyBlobFromSource } from './sourceImage';

const drawImageMock = vi.fn();
const createObjectUrlMock = vi.fn((blob: Blob) => `blob:${blob.type}:${blob.size}`);
const revokeObjectUrlMock = vi.fn();

type ToBlobCall = {
  readonly mimeType: string | undefined;
  readonly quality: number | undefined;
};

const toBlobCalls: ToBlobCall[] = [];

const installCanvasMock = (resolveSize: (mimeType?: string, quality?: number) => number) => {
  vi.stubGlobal('document', {
    createElement: (tagName: string) => {
      if (tagName !== 'canvas') {
        throw new Error(`Unexpected element requested: ${tagName}`);
      }

      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: drawImageMock,
        }),
        toBlob: (
          callback: BlobCallback,
          mimeType?: string,
          quality?: number,
        ) => {
          toBlobCalls.push({ mimeType, quality });
          callback(new Blob([new Uint8Array(resolveSize(mimeType, quality))], {
            type: mimeType ?? 'image/png',
          }));
        },
      };
    },
  });
};

class MockImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 4000;
  naturalHeight = 2000;

  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

describe('preprocess source image working proxy', () => {
  beforeEach(() => {
    toBlobCalls.length = 0;
    drawImageMock.mockClear();
    createObjectUrlMock.mockClear();
    revokeObjectUrlMock.mockClear();
    vi.stubGlobal('Image', MockImage);
    vi.stubGlobal('window', {
      Image: MockImage,
    });
    vi.stubGlobal('URL', {
      createObjectURL: createObjectUrlMock,
      revokeObjectURL: revokeObjectUrlMock,
    });
    vi.stubGlobal('crypto', {
      randomUUID: () => 'source-image-id',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates JPEG working proxies under the byte cap while keeping source dimensions separate', async () => {
    installCanvasMock((mimeType, quality) => {
      if (mimeType !== 'image/jpeg') return 512;
      return quality === 0.92
        ? PREPROCESS_WORKING_PROXY_MAX_BYTES + 1
        : PREPROCESS_WORKING_PROXY_MAX_BYTES - 1;
    });

    const proxy = await createWorkingProxyBlobFromSource(
      new MockImage() as unknown as CanvasImageSource,
      4000,
      2000,
    );

    expect(proxy.blob.type).toBe('image/jpeg');
    expect(proxy.blob.size).toBeLessThanOrEqual(PREPROCESS_WORKING_PROXY_MAX_BYTES);
    expect(proxy.width).toBe(2048);
    expect(proxy.height).toBe(1024);
    expect(toBlobCalls.filter((call) => call.mimeType === 'image/jpeg').map((call) => call.quality)).toEqual([
      0.92,
      0.82,
    ]);
  });

  it('rejects images whose decoded dimensions exceed the pixel cap', async () => {
    installCanvasMock(() => 256);

    class HugeImage extends MockImage {
      naturalWidth = 21000;
      naturalHeight = 21000;
    }
    vi.stubGlobal('Image', HugeImage);
    vi.stubGlobal('window', { Image: HugeImage });

    const file = new File([new Uint8Array(4096)], 'huge.png', {
      type: 'image/png',
    });

    await expect(buildSourceImage(file, 'eosin')).rejects.toThrow(/pixel limit/);
  });

  it('records original source dimensions and JPEG working dimensions on image import', async () => {
    installCanvasMock((mimeType) => (mimeType === 'image/jpeg' ? 1024 : 256));

    const file = new File([new Uint8Array(4096)], 'source.png', {
      type: 'image/png',
      lastModified: 123,
    });

    const image = await buildSourceImage(file, 'eosin');

    expect(image.width).toBe(4000);
    expect(image.height).toBe(2000);
    expect(image.mimeType).toBe('image/png');
    expect(image.sourceBlob).toBe(file);
    expect(image.workingBlob?.type).toBe('image/jpeg');
    expect(image.workingBlob?.size).toBeLessThanOrEqual(PREPROCESS_WORKING_PROXY_MAX_BYTES);
    expect(image.workingWidth).toBe(2048);
    expect(image.workingHeight).toBe(1024);
    expect(image.dataUrl).toBe('blob:image/png:4096');
    expect(image.workingDataUrl).toBe('blob:image/jpeg:1024');
  });
});
