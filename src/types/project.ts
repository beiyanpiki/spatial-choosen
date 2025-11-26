export type Point = { x: number; y: number };

export type Region = {
  id: string;
  label: number;
  color: string;
  points: Point[];
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
  regions: Region[];
};
