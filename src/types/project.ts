export type Point = { x: number; y: number };

export type Region = {
  id: string;
  label: number;
  color: string;
  points: Point[];
  /**
   * Optional list of rings: first is outer boundary, remaining are holes.
   * When absent, fallback to `points` as a single outer ring.
   */
  paths?: Point[][];
};

export type ChipType = '50um' | '15um';

export type ChipRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Spot = {
  x: number;
  y: number;
  sizeX: number;
  sizeY: number;
};

export type MatrixDtype =
  | 'float32'
  | 'float64'
  | 'int32'
  | 'int16'
  | 'int8'
  | 'uint8'
  | 'uint16'
  | 'uint32';

export type ProjectMatrix = {
  shape: number[];
  dtype: MatrixDtype;
  data: ArrayBuffer;
};

export type Project = {
  id: string;
  name: string;
  createdAt: string;
  imageData: string;
  imageWidth?: number;
  imageHeight?: number;
  chipWidth?: number;
  chipHeight?: number;
  chipType?: ChipType | null;
  chipRect?: ChipRect | null;
  spotMatrix?: Spot[][];
  chipFromBundle?: boolean;
  matrixShape?: number[];
  matrixDtype?: MatrixDtype;
  matrixData?: ArrayBuffer;
  regions: Region[];
};
