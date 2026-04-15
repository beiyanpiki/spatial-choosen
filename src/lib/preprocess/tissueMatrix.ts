import type { ProjectedSpot, TissueActivationMatrix, TissueActivationValue } from '@/types/preprocess';

const assertMatrixDimensions = (rows: number, columns: number) => {
  if (!Number.isInteger(rows) || rows <= 0 || !Number.isInteger(columns) || columns <= 0) {
    throw new Error('Tissue matrix dimensions must be positive integers.');
  }
};

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

export function createEmptyMatrix(rows: number, columns: number): TissueActivationMatrix {
  assertMatrixDimensions(rows, columns);

  return {
    rows,
    columns,
    values: Array.from({ length: rows * columns }, () => 0 as TissueActivationValue),
  };
}

export function validateTissueActivationMatrix(matrix: TissueActivationMatrix): TissueActivationMatrix {
  assertMatrixDimensions(matrix.rows, matrix.columns);

  if (matrix.values.length !== matrix.rows * matrix.columns) {
    throw new Error('Tissue matrix length does not match its dimensions.');
  }

  const values = matrix.values.map((value) => {
    if (value !== 0 && value !== 1) {
      throw new Error('Tissue matrix values must be binary.');
    }

    return value;
  });

  return {
    rows: matrix.rows,
    columns: matrix.columns,
    values,
  };
}

export function invertTissueActivationMatrix(matrix: TissueActivationMatrix): TissueActivationMatrix {
  const validated = validateTissueActivationMatrix(matrix);

  return {
    rows: validated.rows,
    columns: validated.columns,
    values: validated.values.map((value) => (value === 0 ? 1 : 0)),
  };
}

export function selectedSpotIdsFromMatrix(
  matrix: TissueActivationMatrix,
  projectedSpots: ProjectedSpot[],
): string[] {
  const validated = validateTissueActivationMatrix(matrix);

  return projectedSpots.flatMap((spot) => {
    const index = toMatrixIndex(validated.rows, validated.columns, spot.arrayRow, spot.arrayCol);
    return index !== null && validated.values[index] === 1 ? [spot.id] : [];
  });
}

export function matrixFromSelectedSpotIds(args: {
  rows: number;
  columns: number;
  projectedSpots: ProjectedSpot[];
  selectedSpotIds: string[];
}): TissueActivationMatrix {
  const matrix = createEmptyMatrix(args.rows, args.columns);
  const selectedSpotIds = new Set(args.selectedSpotIds);

  for (const spot of args.projectedSpots) {
    if (!selectedSpotIds.has(spot.id)) {
      continue;
    }

    const index = toMatrixIndex(matrix.rows, matrix.columns, spot.arrayRow, spot.arrayCol);
    if (index === null) {
      continue;
    }

    matrix.values[index] = 1;
  }

  return matrix;
}
