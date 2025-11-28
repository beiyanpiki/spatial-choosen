import NpyJs, { DType } from 'npyjs';
import { MatrixDtype } from '@/types/project';

export interface BundleResponse {
  image: {
    mime: string;
    data: string; // base64
  };
  coord: {
    mime: string;
    data: string; // base64 string
  };
  matrix: {
    mime: string; // typically application/octet-stream
    data: string; // base64 string of npy
  };
}

export interface Coord {
  chip?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NpyResult {
  data:
    | Float32Array
    | Float64Array
    | Int32Array
    | Int16Array
    | Int8Array
    | Uint8Array
    | Uint16Array
    | Uint32Array;
  shape: number[];
  fortranOrder?: boolean;
  dtype: MatrixDtype;
}

export type DecodedBundle = {
  imageUrl: string; // Object URL for previews
  imageDataUrl: string; // data URL for persistence
  coord: Coord;
  matrix: NpyResult;
};

const dtypeCodeToMatrixDtype = (dtype: DType): MatrixDtype => {
  if (dtype === 'f4') return 'float32';
  if (dtype === 'f8') return 'float64';
  if (dtype === 'i4') return 'int32';
  if (dtype === 'i2') return 'int16';
  if (dtype === 'i1') return 'int8';
  if (dtype === 'u1') return 'uint8';
  if (dtype === 'u2') return 'uint16';
  if (dtype === 'u4') return 'uint32';
  throw new Error(`Unsupported numpy dtype: ${dtype}`);
};

const reorderFortranToC = (data: NpyResult['data'], shape: number[]): NpyResult['data'] => {
  if (shape.length === 0) return data;
  const total = data.length;
  const C = data.constructor as { new(length: number): NpyResult['data'] };
  const out = new C(total);

  // compute C strides (last dim fastest)
  const cStrides = new Array(shape.length).fill(0);
  cStrides[shape.length - 1] = 1;
  for (let i = shape.length - 2; i >= 0; i -= 1) {
    cStrides[i] = cStrides[i + 1] * shape[i + 1];
  }

  // Fortran strides (first dim fastest)
  const fStrides = new Array(shape.length).fill(0);
  fStrides[0] = 1;
  for (let i = 1; i < shape.length; i += 1) {
    fStrides[i] = fStrides[i - 1] * shape[i - 1];
  }

  for (let linearC = 0; linearC < total; linearC += 1) {
    // derive multi-dimensional index from C strides
    let remainder = linearC;
    const idx = new Array(shape.length).fill(0);
    for (let k = 0; k < shape.length; k += 1) {
      idx[k] = Math.floor(remainder / cStrides[k]);
      remainder -= idx[k] * cStrides[k];
    }
    // map to Fortran linear index
    let linearF = 0;
    for (let k = 0; k < shape.length; k += 1) {
      linearF += idx[k] * fStrides[k];
    }
    out[linearC] = data[linearF];
  }
  return out;
};

export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function base64ToBlob(b64: string, mime: string): Blob {
  const bytes = base64ToUint8Array(b64);
  return new Blob([bytes], { type: mime });
}

export async function base64ToText(b64: string, mime = 'application/json'): Promise<string> {
  const blob = base64ToBlob(b64, mime);
  return blob.text();
}

export async function parseNpyBase64(b64: string): Promise<NpyResult> {
  const bytes = base64ToUint8Array(b64);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const npy = new NpyJs();
  const parsed = await npy.load(buffer);
  const matrixDtype = dtypeCodeToMatrixDtype(parsed.dtype);
  if (parsed.fortranOrder) {
    // Let the browser render before heavy reordering on large arrays.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const data = parsed.fortranOrder ? reorderFortranToC(parsed.data as NpyResult['data'], parsed.shape) : parsed.data;
  return { data: data as NpyResult['data'], shape: parsed.shape, dtype: matrixDtype, fortranOrder: parsed.fortranOrder };
}

const extractCoord = (raw: unknown): Coord => {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid coord payload');

  const obj = raw as Record<string, unknown>;
  const candidates: Record<string, unknown>[] = [];

  // common wrappers seen from different producers
  if (obj.hull_position && typeof obj.hull_position === 'object') candidates.push(obj.hull_position as Record<string, unknown>);
  if (obj.hullPosition && typeof obj.hullPosition === 'object') candidates.push(obj.hullPosition as Record<string, unknown>);
  if (obj.hull && typeof obj.hull === 'object') candidates.push(obj.hull as Record<string, unknown>);
  candidates.push(obj);

  const toNumber = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  for (const candidate of candidates) {
    const chipValue = (candidate.chip ?? candidate.chip_type ?? candidate.chipType ?? obj.chip ?? obj.chip_type ?? obj.chipType) as string | undefined;
    const numX = toNumber(candidate.x);
    const numY = toNumber(candidate.y);
    const numW = toNumber(candidate.width);
    const numH = toNumber(candidate.height ?? candidate.heigth); // tolerate typo
    if (numX === null || numY === null || numW === null || numH === null) {
      continue;
    }
    return { chip: chipValue, x: numX, y: numY, width: numW, height: numH };
  }

  throw new Error('Coord payload missing numeric x/y/width/height');
};

export async function decodeBundleFromObject(bundle: BundleResponse): Promise<DecodedBundle> {
  const imageDataUrl = `data:${bundle.image.mime};base64,${bundle.image.data}`;
  const imageBlob = base64ToBlob(bundle.image.data, bundle.image.mime);
  const imageUrl = URL.createObjectURL(imageBlob);
  const coordText = await base64ToText(bundle.coord.data, bundle.coord.mime);
  const coord = extractCoord(JSON.parse(coordText));
  const matrix = await parseNpyBase64(bundle.matrix.data);
  return { imageUrl, imageDataUrl, coord, matrix };
}

export async function decodeBundleFromText(text: string): Promise<DecodedBundle> {
  const parsed = JSON.parse(text) as BundleResponse;
  return decodeBundleFromObject(parsed);
}

export async function decodeBundleFromFile(file: File): Promise<DecodedBundle> {
  const text = await file.text();
  return decodeBundleFromText(text);
}

export async function decodeBundle(url: string = '/api/bundle'): Promise<DecodedBundle> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch bundle: ${res.status} ${res.statusText}`);
  }
  const bundle = (await res.json()) as BundleResponse;
  return decodeBundleFromObject(bundle);
}
