import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import ts from 'typescript';

let sourceImageHarnessScriptsPromise: Promise<{
  sourceImage: string;
  constants: string;
  safety: string;
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

async function loadSourceImageHarnessScripts() {
  sourceImageHarnessScriptsPromise ??= (async () => {
    const [sourceImageSource, constantsSource, safetySource] = await Promise.all([
      fs.readFile(path.join(process.cwd(), 'src/lib/preprocess/sourceImage.ts'), 'utf8'),
      fs.readFile(path.join(process.cwd(), 'src/lib/preprocess/constants.ts'), 'utf8'),
      fs.readFile(path.join(process.cwd(), 'src/lib/preprocess/safety.ts'), 'utf8'),
    ]);

    return {
      sourceImage: transpileBrowserModule(sourceImageSource, 'sourceImage.ts'),
      constants: transpileBrowserModule(constantsSource, 'constants.ts'),
      safety: transpileBrowserModule(safetySource, 'safety.ts'),
    };
  })();

  return sourceImageHarnessScriptsPromise;
}

test('TIFF thumbnails are derived from decoded raster without browser re-decode', async ({ page }) => {
  const scripts = await loadSourceImageHarnessScripts();
  await page.setContent('<!DOCTYPE html><html><body></body></html>');

  const result = await page.evaluate(async ({ scripts }) => {
    const moduleCache = new Map<string, { exports: Record<string, unknown> }>();

    const loadModule = (id: string) => {
      const cached = moduleCache.get(id);
      if (cached) {
        return cached.exports;
      }

      const source = id === 'sourceImage'
        ? scripts.sourceImage
        : id === 'constants'
          ? scripts.constants
          : id === 'safety'
            ? scripts.safety
            : null;
      if (!source) {
        throw new Error(`Unknown browser module: ${id}`);
      }

      const moduleContext = { exports: {} as Record<string, unknown> };
      moduleCache.set(id, moduleContext);

      const localRequire = (specifier: string) => {
        if (specifier === './constants') {
          return loadModule('constants');
        }
        if (specifier === './safety') {
          return loadModule('safety');
        }
        if (specifier === 'utif') {
          return {
            decode: () => [{ width: 4, height: 4, t256: [4], t257: [4] }],
            decodeImage: () => undefined,
            toRGBA8: () => new Uint8Array(4 * 4 * 4).fill(255),
          };
        }

        throw new Error(`Unsupported require from ${id}: ${specifier}`);
      };

      new Function('require', 'module', 'exports', source)(localRequire, moduleContext, moduleContext.exports);
      return moduleContext.exports;
    };

    const { buildSourceImage } = loadModule('sourceImage') as {
      buildSourceImage: (file: File, kind: 'eosin' | 'he') => Promise<Record<string, unknown>>;
    };

    class ThrowingImage {
      onload: (() => void) | null = null;
      onerror: ((error?: unknown) => void) | null = null;
      set src(_value: string) {
        this.onerror?.(new Error('Unexpected browser image decode during TIFF thumbnail generation'));
      }
      get naturalWidth() {
        return 0;
      }
      get naturalHeight() {
        return 0;
      }
    }

    Object.defineProperty(window, 'Image', {
      configurable: true,
      writable: true,
      value: ThrowingImage,
    });

    const file = new File([new Uint8Array([1, 2, 3, 4])], 'fixture.tiff', {
      type: 'image/tiff',
      lastModified: Date.now(),
    });

    const built = await buildSourceImage(file, 'eosin');
    const thumbnailBlob = built.thumbnailBlob;

    return {
      width: built.width,
      height: built.height,
      mimeType: built.mimeType,
      thumbnailBlobSize: thumbnailBlob instanceof Blob ? thumbnailBlob.size : 0,
    };
  }, { scripts });

  expect(result.width).toBe(4);
  expect(result.height).toBe(4);
  expect(result.mimeType).toBe('image/png');
  expect(result.thumbnailBlobSize).toBeGreaterThan(0);
});
