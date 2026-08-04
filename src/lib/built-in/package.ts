import JSZip from 'jszip';
import type {
  PreprocessImageKind,
  PreprocessProject,
  PreprocessSourceImage,
  PreprocessStepId,
} from '@/types/built-in';
import { PREPROCESS_NUMERIC_DEFAULTS } from '@/lib/built-in/constants';
import { migratePreprocessProject } from './migrations';
import { createWorkingProxyBlobFromSource, loadImageElement } from '@/lib/built-in/sourceImage';

export const PACKAGE_VERSION = 4;

type PackagedSourceImage = Omit<
  PreprocessSourceImage,
  | 'sourceBlob'
  | 'thumbnailBlob'
  | 'workingBlob'
  | 'objectUrl'
  | 'thumbnailObjectUrl'
  | 'workingObjectUrl'
  | 'dataUrl'
  | 'thumbnailDataUrl'
  | 'workingDataUrl'
>;

type PreprocessPackagedProject = Omit<
  PreprocessProject,
  'sourceAssets' | 'chipConfig'
> & {
  sourceAssets: Omit<PreprocessProject['sourceAssets'], 'images'> & {
    images: { he: PackagedSourceImage | null };
  };
  chipConfig: Omit<PreprocessProject['chipConfig'], 'projectedSpots'> & {
    projectedSpots: null;
  };
};

type PreprocessPackageV1 = {
  version: 1;
  project: PreprocessPackagedProject;
};

type PreprocessPackageV2 = {
  version: 2;
  project: PreprocessPackagedProject;
};

type PreprocessPackageV3 = {
  version: 3;
  project: PreprocessPackagedProject;
};

type PreprocessPackageV4 = {
  version: typeof PACKAGE_VERSION;
  project: PreprocessPackagedProject;
};

type PreprocessPackage = PreprocessPackageV1 | PreprocessPackageV2 | PreprocessPackageV3 | PreprocessPackageV4;

const isBrowser = () => typeof window !== 'undefined';

const PREPROCESS_MIME_TYPE = 'application/x-spatial-preprocess+json';

const packageSourcePath = (kind: PreprocessImageKind) => `source-assets/${kind}`;

const stripRuntimeImageState = (image: PreprocessSourceImage | null): PackagedSourceImage | null => {
  if (!image) return null;
  const {
    sourceBlob,
    thumbnailBlob,
    workingBlob,
    objectUrl,
    thumbnailObjectUrl,
    workingObjectUrl,
    dataUrl,
    thumbnailDataUrl,
    workingDataUrl,
    ...rest
  } = image;
  void sourceBlob;
  void thumbnailBlob;
  void workingBlob;
  void objectUrl;
  void thumbnailObjectUrl;
  void workingObjectUrl;
  void dataUrl;
  void thumbnailDataUrl;
  void workingDataUrl;
  return rest;
};

const toPackagedProject = (project: PreprocessProject): PreprocessPackagedProject => ({
  ...project,
  sourceAssets: {
    ...project.sourceAssets,
    images: {
      he: stripRuntimeImageState(project.sourceAssets.images.he),
    },
  },
  chipConfig: {
    ...project.chipConfig,
    // projectedSpots are recomputed in the UI after load; never package them.
    projectedSpots: null,
  },
  // tissueSelection (including its matrix) travels inline in the package.
});

const getWorkingDimensions = (sourceWidth: number, sourceHeight: number) => {
  const longestEdge = Math.max(sourceWidth, sourceHeight);
  const scale = longestEdge > 0 ? Math.min(1, PREPROCESS_NUMERIC_DEFAULTS.workingMaxDimension / longestEdge) : 1;

  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
};

const hydratePackagedSourceBlob = async (
  image: PreprocessSourceImage,
  blob: Blob,
): Promise<PreprocessSourceImage> => {
  const sourceBlob = blob.type || !image.mimeType
    ? blob
    : new Blob([blob], { type: image.mimeType });
  const objectUrl = URL.createObjectURL(sourceBlob);
  const hydratedImage: PreprocessSourceImage = {
    ...image,
    sourceBlob,
    objectUrl,
    dataUrl: objectUrl,
  };

  if (hydratedImage.workingBlob || hydratedImage.workingDataUrl || hydratedImage.workingObjectUrl) {
    return hydratedImage;
  }

  try {
    const sourceImage = await loadImageElement(objectUrl);
    const workingProxy = await createWorkingProxyBlobFromSource(
      sourceImage,
      sourceImage.naturalWidth,
      sourceImage.naturalHeight,
    );
    const workingObjectUrl = URL.createObjectURL(workingProxy.blob);
    const workingDimensions = getWorkingDimensions(sourceImage.naturalWidth, sourceImage.naturalHeight);

    return {
      ...hydratedImage,
      workingBlob: workingProxy.blob,
      workingObjectUrl,
      workingDataUrl: workingObjectUrl,
      workingWidth: workingProxy.width ?? hydratedImage.workingWidth ?? workingDimensions.width,
      workingHeight: workingProxy.height ?? hydratedImage.workingHeight ?? workingDimensions.height,
    };
  } catch (error) {
    void error;
    return hydratedImage;
  }
};

const attachPackagedSourceBlobs = async (
  project: PreprocessProject,
  zip: JSZip,
): Promise<PreprocessProject> => {
  const image = project.sourceAssets.images.he;
  if (!image) {
    return project;
  }

  const entry = zip.file(packageSourcePath('he'));
  if (!entry) {
    throw new Error(`ZIP is missing ${packageSourcePath('he')}`);
  }

  const he = await hydratePackagedSourceBlob(image, await entry.async('blob'));

  return {
    ...project,
    sourceAssets: {
      ...project.sourceAssets,
      images: {
        he,
      },
    },
  };
};

const assertObject = (value: unknown, fieldName: string) => {
  if (!value || typeof value !== 'object') {
    throw new Error(`Project field "${fieldName}" is invalid or missing`);
  }
};

const assertString = (value: unknown, fieldName: string) => {
  if (typeof value !== 'string') {
    throw new Error(`Project field "${fieldName}" is invalid or missing`);
  }
};

const assertPreprocessStepId = (value: unknown, fieldName: string) => {
  const allowedStepIds: readonly PreprocessStepId[] = ['sourceAssets', 'tissueSelection'];
  if (typeof value !== 'string' || !allowedStepIds.includes(value as PreprocessStepId)) {
    throw new Error(`Project field "${fieldName}" is invalid or missing`);
  }
};

const assertSourceImage = (
  value: unknown,
  kind: PreprocessImageKind,
): PackagedSourceImage | null => {
  if (value === null) return null;
  assertObject(value, `sourceAssets.images.${kind}`);
  const image = value as Record<string, unknown>;
  if (image.kind !== kind) {
    throw new Error(`Project field "sourceAssets.images.${kind}.kind" is invalid or missing`);
  }
  assertString(image.id, `sourceAssets.images.${kind}.id`);
  assertString(image.fileName, `sourceAssets.images.${kind}.fileName`);
  assertString(image.mimeType, `sourceAssets.images.${kind}.mimeType`);
  if (typeof image.sizeBytes !== 'number') {
    throw new Error(`Project field "sourceAssets.images.${kind}.sizeBytes" is invalid or missing`);
  }
  return image as PackagedSourceImage;
};

const assertPreprocessProjectShape = (value: unknown): PreprocessProject => {
  assertObject(value, 'project');
  const project = value as Record<string, unknown>;

  assertString(project.id, 'id');
  assertString(project.name, 'name');
  assertString(project.createdAt, 'createdAt');
  assertString(project.updatedAt, 'updatedAt');
  if (typeof project.workflowVersion !== 'number') {
    throw new Error('Project field "workflowVersion" is invalid or missing');
  }
  assertPreprocessStepId(project.currentStep, 'currentStep');

  assertObject(project.sourceAssets, 'sourceAssets');
  assertObject(project.chipConfig, 'chipConfig');
  assertObject(project.tissueSelection, 'tissueSelection');

  const sourceAssets = project.sourceAssets as Record<string, unknown>;
  assertObject(sourceAssets.images, 'sourceAssets.images');
  const images = sourceAssets.images as Record<string, unknown>;

  // Surplus top-level keys (localization/heFocus/alignment/cropQc/exportState)
  // from older bundles are intentionally ignored for forward compatibility.

  const storageVersion = typeof project.storageVersion === 'number' ? project.storageVersion : 0;

  return {
    ...(project as unknown as PreprocessProject),
    storageVersion,
    sourceAssets: {
      ...(sourceAssets as unknown as PreprocessProject['sourceAssets']),
      images: {
        he: assertSourceImage(images.he, 'he'),
      },
    },
  } as PreprocessProject;
};

export async function serializePreprocessProject(project: PreprocessProject): Promise<Blob> {
  if (!isBrowser()) {
    throw new Error('Preprocessing project export is available in-browser only');
  }

  const payload: PreprocessPackageV4 = {
    version: PACKAGE_VERSION,
    project: toPackagedProject(project),
  };

  return new Blob([JSON.stringify(payload)], {
    type: PREPROCESS_MIME_TYPE,
  });
}

export async function deserializePreprocessProject(file: File | Blob): Promise<PreprocessProject> {
  if (!isBrowser()) {
    throw new Error('Preprocessing project import is available in-browser only');
  }

  const text = await file.text();
  return deserializePreprocessProjectText(text);
}

export function deserializePreprocessProjectText(text: string): PreprocessProject {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON');
  }

  const pkg = parsed as Partial<PreprocessPackage>;
  if (pkg.version !== 1 && pkg.version !== 2 && pkg.version !== 3 && pkg.version !== PACKAGE_VERSION) {
    throw new Error('Unsupported package version. Please re-export with the latest app.');
  }

  return migratePreprocessProject(assertPreprocessProjectShape(pkg.project));
}

const toZipLoadInput = async (file: File | Blob) => (
  typeof FileReader !== 'undefined'
    ? file
    : await file.arrayBuffer()
);

export async function deserializePreprocessImport(file: File | Blob): Promise<PreprocessProject> {
  if (!isBrowser()) {
    throw new Error('Preprocessing project import is available in-browser only');
  }

  const fileName = typeof File !== 'undefined' && file instanceof File
    ? file.name.toLowerCase()
    : '';
  if (fileName.endsWith('.zip')) {
    const zip = await JSZip.loadAsync(await toZipLoadInput(file));
    const projectEntry = zip.file('project.json');
    if (!projectEntry) {
      throw new Error('ZIP does not contain project.json');
    }
    const text = await projectEntry.async('text');
    const project = deserializePreprocessProjectText(text);
    return attachPackagedSourceBlobs(project, zip);
  }

  return deserializePreprocessProject(file);
}
