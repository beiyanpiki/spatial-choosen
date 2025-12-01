import { Project } from '@/types/project';
import { base64ToUint8Array } from './bundleDecoder';

/**
 * Versioned package format for portable project exports.
 */
export const PACKAGE_VERSION = 1;

type ProjectPackageV1 = {
  version: typeof PACKAGE_VERSION;
  project: Omit<Project, 'matrixData'>;
  matrixDataBase64?: string;
};

const isBrowser = () => typeof window !== 'undefined';

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const requireBase64 = (b64?: string): Uint8Array | undefined => {
  if (!b64) return undefined;
  return base64ToUint8Array(b64);
};

const assertProjectShape = (value: unknown): Project => {
  if (!value || typeof value !== 'object') {
    throw new Error('Package project payload is missing');
  }
  const obj = value as Record<string, unknown>;
  const requiredString = ['id', 'name', 'createdAt', 'imageData'] as const;
  for (const key of requiredString) {
    if (typeof obj[key] !== 'string') {
      throw new Error(`Project field "${key}" is invalid or missing`);
    }
  }
  if (!Array.isArray(obj.regions)) {
    throw new Error('Project regions missing');
  }
  return obj as Project;
};

export async function serializeProject(project: Project): Promise<Blob> {
  if (!isBrowser()) {
    throw new Error('Project export is available in-browser only');
  }
  const { matrixData, ...rest } = project;
  const matrixDataBase64 = matrixData ? arrayBufferToBase64(matrixData) : undefined;
  const payload: ProjectPackageV1 = {
    version: PACKAGE_VERSION,
    project: rest,
    matrixDataBase64,
  };
  const json = JSON.stringify(payload);
  return new Blob([json], { type: 'application/x-spatialproj+json' });
}

export async function deserializeProject(file: File | Blob): Promise<Project> {
  if (!isBrowser()) {
    throw new Error('Project import is available in-browser only');
  }
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error('File is not valid JSON');
  }
  const pkg = parsed as Partial<ProjectPackageV1>;
  if (pkg.version !== PACKAGE_VERSION) {
    throw new Error('Unsupported package version. Please re-export with the latest app.');
  }
  const project = assertProjectShape(pkg.project);
  const matrixBytes = requireBase64(pkg.matrixDataBase64);
  return {
    ...project,
    // Create a fresh ArrayBuffer to satisfy consumers that expect a non-shared buffer
    matrixData: matrixBytes ? matrixBytes.slice().buffer : undefined,
  };
}
