import polygonClipping from 'polygon-clipping';

import type {
  PreprocessPoint,
  ProjectedSpot,
  TissueActivationMatrix,
  TissueActivationValue,
} from '@/types/built-in-admin';

import { validateTissueActivationMatrix } from './tissueMatrix';

type PolygonRing = [number, number][];
type PolygonGeometry = PolygonRing[];
type MultiPolygonGeometry = PolygonGeometry[];

const OVERLAP_EPSILON = 1e-9;

const toMatrixIndex = (
  rows: number,
  columns: number,
  arrayRow: number,
  arrayCol: number,
) => {
  if (
    !Number.isInteger(arrayRow)
    || !Number.isInteger(arrayCol)
    || arrayRow < 1
    || arrayRow > rows
    || arrayCol < 1
    || arrayCol > columns
  ) {
    return null;
  }

  return (arrayRow - 1) * columns + (arrayCol - 1);
};

const ringArea = (ring: PolygonRing) => {
  let area = 0;

  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    if (!current || !next) {
      continue;
    }

    area += current[0] * next[1] - next[0] * current[1];
  }

  return Math.abs(area) / 2;
};

const multiPolygonArea = (geometry: MultiPolygonGeometry) => geometry.reduce((totalArea, polygon) => {
  if (polygon.length === 0) {
    return totalArea;
  }

  const [outerRing, ...holes] = polygon;
  const holeArea = holes.reduce((sum, hole) => sum + ringArea(hole), 0);

  return totalArea + ringArea(outerRing) - holeArea;
}, 0);

const toEditPolygon = (editArea: PreprocessPoint[]): PolygonGeometry => [
  editArea.map((point) => [point.x, point.y] as [number, number]),
];

const toSpotFootprintPolygon = (spot: ProjectedSpot): PolygonGeometry => {
  const width = spot.width ?? spot.diameterX;
  const height = spot.height ?? spot.diameterY;
  const left = spot.x - width / 2;
  const right = spot.x + width / 2;
  const top = spot.y - height / 2;
  const bottom = spot.y + height / 2;

  return [[
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ]];
};

const hasPositiveAreaOverlap = (editArea: PreprocessPoint[], spot: ProjectedSpot) => {
  if (editArea.length < 3) {
    return false;
  }

  const overlap = polygonClipping.intersection(
    toEditPolygon(editArea),
    toSpotFootprintPolygon(spot),
  ) as MultiPolygonGeometry;

  return overlap.length > 0 && multiPolygonArea(overlap) > OVERLAP_EPSILON;
};

export function applyTissueMatrixEdit(args: {
  matrix: TissueActivationMatrix;
  projectedSpots: ProjectedSpot[];
  editArea: PreprocessPoint[];
  nextValue: TissueActivationValue;
}): TissueActivationMatrix {
  validateTissueActivationMatrix(args.matrix);
  const matrix = args.matrix;
  let nextValues = matrix.values;
  let didChange = false;

  for (const spot of args.projectedSpots) {
    if (!hasPositiveAreaOverlap(args.editArea, spot)) {
      continue;
    }

    const index = toMatrixIndex(matrix.rows, matrix.columns, spot.arrayRow, spot.arrayCol);
    if (index === null) {
      continue;
    }

    if (matrix.values[index] === args.nextValue) {
      continue;
    }

    if (!didChange) {
      nextValues = [...matrix.values];
      didChange = true;
    }

    nextValues[index] = args.nextValue;
  }

  if (!didChange) {
    return matrix;
  }

  return {
    rows: matrix.rows,
    columns: matrix.columns,
    values: nextValues,
  };
}
