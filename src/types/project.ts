export type Point = { x: number; y: number };

export type Region = {
  id: string;
  label: number;
  color: string;
  points: Point[];
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
  regions: Region[];
};
