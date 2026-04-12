import { expect, test } from '@playwright/test';

const PREPROCESS_STORAGE_KEY = 'spatial-preprocess-projects';
const PREPROCESS_DB_NAME = 'spatial-preprocess';
const PREPROCESS_SOURCE_IMAGE_STORE = 'preprocess-source-images';
const PREPROCESS_THUMBNAIL_STORE = 'preprocess-thumbnails';
const PREPROCESS_DERIVED_IMAGE_STORE = 'preprocess-derived-images';
const URL_STATS_KEY = '__preprocess-url-stats';
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=';

async function createProject(page: import('@playwright/test').Page, name: string) {
  await page.goto('/preprocess');
  await page.getByPlaceholder('Tumor preprocess set A').fill(name);
  await page.getByTestId('preprocess-create-project').click();
  await expect(page).toHaveURL(/preprocess_id=/);

  const preprocessId = new URL(page.url()).searchParams.get('preprocess_id');
  if (!preprocessId) {
    throw new Error('Missing preprocess_id in URL');
  }

  return preprocessId;
}

async function installObjectUrlCounters(page: import('@playwright/test').Page) {
  await page.addInitScript((statsKey) => {
    const globalWindow = window as typeof window & { __preprocessUrlCountersInstalled?: boolean };
    if (globalWindow.__preprocessUrlCountersInstalled) {
      return;
    }

    globalWindow.__preprocessUrlCountersInstalled = true;

    const readStats = () => {
      const raw = window.sessionStorage.getItem(statsKey);
      if (!raw) {
        return { created: [] as string[], revoked: [] as string[] };
      }

      return JSON.parse(raw) as { created: string[]; revoked: string[] };
    };

    const writeStats = (stats: { created: string[]; revoked: string[] }) => {
      window.sessionStorage.setItem(statsKey, JSON.stringify(stats));
    };

    writeStats({ created: [], revoked: [] });

    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);

    URL.createObjectURL = ((object: Blob | MediaSource) => {
      const url = originalCreateObjectURL(object);
      const stats = readStats();
      stats.created.push(url);
      writeStats(stats);
      return url;
    }) as typeof URL.createObjectURL;

    URL.revokeObjectURL = ((url: string) => {
      const stats = readStats();
      stats.revoked.push(String(url));
      writeStats(stats);
      return originalRevokeObjectURL(url);
    }) as typeof URL.revokeObjectURL;
  }, URL_STATS_KEY);
}

async function resetObjectUrlCounters(page: import('@playwright/test').Page) {
  await page.evaluate((statsKey) => {
    window.sessionStorage.setItem(statsKey, JSON.stringify({ created: [], revoked: [] }));
  }, URL_STATS_KEY);
}

async function readObjectUrlCounters(page: import('@playwright/test').Page) {
  return page.evaluate((statsKey) => {
    const raw = window.sessionStorage.getItem(statsKey);
    return raw
      ? JSON.parse(raw) as { created: string[]; revoked: string[] }
      : { created: [], revoked: [] };
  }, URL_STATS_KEY);
}

async function seedBlobBackedProject(
  page: import('@playwright/test').Page,
  args: { includeDerivedAssets: boolean; projectName: string },
) {
  const preprocessId = await createProject(page, args.projectName);

  await page.evaluate(async ({
    preprocessId,
    preprocessStorageKey,
    preprocessDbName,
    preprocessSourceImageStore,
    preprocessThumbnailStore,
    preprocessDerivedImageStore,
    pngDataUrl,
    includeDerivedAssets,
  }) => {
    const now = new Date().toISOString();
    const raw = window.localStorage.getItem(preprocessStorageKey);
    const projects = raw ? JSON.parse(raw) as Array<Record<string, unknown>> : [];
    const index = projects.findIndex((entry) => entry.id === preprocessId);
    if (index < 0) {
      throw new Error('Unable to find seeded preprocess project');
    }

    const sourceImageMeta = (kind: 'eosin' | 'he') => ({
      id: `${preprocessId}-${kind}`,
      kind,
      fileName: `${kind}.png`,
      mimeType: 'image/png',
      sizeBytes: 68,
      width: 1,
      height: 1,
      lastModified: null,
    });

    const emptyCropAssetSet = () => ({
      fullres: { dataUrl: null },
      hires: { dataUrl: null },
      lowres: { dataUrl: null },
    });

    const project = projects[index];
    project.currentStep = includeDerivedAssets ? 'cropQc' : 'sourceAssets';
    project.updatedAt = now;
    project.sourceAssets = {
      ...(project.sourceAssets as Record<string, unknown>),
      activeImage: 'eosin',
      images: {
        eosin: sourceImageMeta('eosin'),
        he: sourceImageMeta('he'),
      },
    };

    if (includeDerivedAssets) {
      project.heFocus = {
        ...(project.heFocus as Record<string, unknown>),
        status: 'complete',
        isStale: false,
        error: null,
        updatedAt: now,
        chipBounds: { x: 0, y: 0, width: 1, height: 1 },
        handles: [],
        focusedImageDataUrl: null,
      };
      project.cropQc = {
        ...(project.cropQc as Record<string, unknown>),
        status: 'complete',
        isStale: false,
        error: null,
        updatedAt: now,
        cropRect: { x: 0, y: 0, width: 1, height: 1 },
        cropWidth: 1,
        cropHeight: 1,
        tissue_hires_scalef: 1,
        tissue_lowres_scalef: 1,
        spot_diameter_fullres: 1,
        fiducial_diameter_fullres: 1,
        cropAssets: {
          eosin: emptyCropAssetSet(),
          he: emptyCropAssetSet(),
        },
        eosinPreviewDataUrl: null,
        previewDataUrl: null,
        checkerboardPreviewDataUrl: null,
        checkerboardPreview: { dataUrl: null },
        featureMatchesPreviewDataUrl: null,
        featureMatchesPreview: { dataUrl: null },
      };
    }

    projects[index] = project;
    window.localStorage.setItem(preprocessStorageKey, JSON.stringify(projects));

    const blob = await fetch(pngDataUrl).then((response) => response.blob());

    const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open(preprocessDbName);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(preprocessSourceImageStore)) {
          db.createObjectStore(preprocessSourceImageStore);
        }
        if (!db.objectStoreNames.contains(preprocessThumbnailStore)) {
          db.createObjectStore(preprocessThumbnailStore);
        }
        if (!db.objectStoreNames.contains(preprocessDerivedImageStore)) {
          db.createObjectStore(preprocessDerivedImageStore);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const put = (db: IDBDatabase, storeName: string, key: string, value: Blob) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    const db = await openDb();
    try {
      await Promise.all([
        put(db, preprocessSourceImageStore, `${preprocessId}:eosin`, blob),
        put(db, preprocessSourceImageStore, `${preprocessId}:he`, blob),
        put(db, preprocessThumbnailStore, `${preprocessId}:eosin`, blob),
        put(db, preprocessThumbnailStore, `${preprocessId}:he`, blob),
      ]);

      if (includeDerivedAssets) {
        const derivedKeys = [
          `${preprocessId}:he-focus`,
          `${preprocessId}:crop-qc:eosin:fullres`,
          `${preprocessId}:crop-qc:eosin:hires`,
          `${preprocessId}:crop-qc:eosin:lowres`,
          `${preprocessId}:crop-qc:he:fullres`,
          `${preprocessId}:crop-qc:he:hires`,
          `${preprocessId}:crop-qc:he:lowres`,
          `${preprocessId}:crop-qc:checkerboard`,
          `${preprocessId}:crop-qc:feature-matches`,
        ];

        for (const key of derivedKeys) {
          await put(db, preprocessDerivedImageStore, key, blob);
        }
      }
    } finally {
      db.close();
    }
  }, {
    preprocessId,
    preprocessStorageKey: PREPROCESS_STORAGE_KEY,
    preprocessDbName: PREPROCESS_DB_NAME,
    preprocessSourceImageStore: PREPROCESS_SOURCE_IMAGE_STORE,
    preprocessThumbnailStore: PREPROCESS_THUMBNAIL_STORE,
    preprocessDerivedImageStore: PREPROCESS_DERIVED_IMAGE_STORE,
    pngDataUrl: PNG_DATA_URL,
    includeDerivedAssets: args.includeDerivedAssets,
  });

  return { preprocessId };
}

test('landing does not hydrate blob-backed preprocess assets before opening a workspace', async ({ page }) => {
  await installObjectUrlCounters(page);

  await seedBlobBackedProject(page, {
    includeDerivedAssets: true,
    projectName: `preprocess-memory-landing-${Date.now()}`,
  });

  await resetObjectUrlCounters(page);
  await page.goto('/preprocess');
  await expect(page.getByTestId('preprocess-project-list')).toBeVisible();

  const stats = await readObjectUrlCounters(page);
  expect(stats.created).toHaveLength(0);
  expect(stats.revoked).toHaveLength(0);
});

test('returning to landing revokes all blob URLs hydrated for a preprocess workspace', async ({ page }) => {
  await installObjectUrlCounters(page);

  const { preprocessId } = await seedBlobBackedProject(page, {
    includeDerivedAssets: true,
    projectName: `preprocess-memory-revoke-${Date.now()}`,
  });

  await resetObjectUrlCounters(page);
  await page.goto(`/preprocess?preprocess_id=${encodeURIComponent(preprocessId)}`);
  await expect(page.getByTestId('preprocess-workspace-shell')).toBeVisible();

  await page.getByRole('button', { name: '← Back to preprocess projects' }).click();
  await expect(page.getByTestId('preprocess-project-list')).toBeVisible();

  await expect.poll(async () => {
    const stats = await readObjectUrlCounters(page);
    return stats.created.length > 0 && stats.revoked.length === stats.created.length;
  }).toBe(true);

  const stats = await readObjectUrlCounters(page);
  expect(stats.created.length).toBeGreaterThan(0);
  expect(stats.revoked.length).toBe(stats.created.length);
});
