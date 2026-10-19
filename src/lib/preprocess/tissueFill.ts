import type { TissueActivationMatrix } from '@/types/preprocess';

import { validateTissueActivationMatrix } from './tissueMatrix';

/**
 * Derives the contour-filled tissue matrix for the tissue selection step.
 *
 * The auto-detected selection traces one rough contour per connected tissue
 * region (a single run can yield several disjoint regions). Filling a contour
 * means every background cell that the contour encloses becomes tissue, so
 * interior gaps the detector missed are covered while the outer boundary stays
 * untouched. Enclosure is decided by flooding the background from the matrix
 * border with 4-connectivity: unreached background cells sit inside a closed
 * contour and are filled. Corner-touching selections therefore still close
 * their contour, matching how the drawn spot squares tile the grid.
 *
 * The returned matrix is independent from the input: the input is validated
 * but never mutated, and the output always gets a fresh values array.
 */
export function deriveFilledTissueMatrix(
  matrix: TissueActivationMatrix,
): TissueActivationMatrix {
  const validated = validateTissueActivationMatrix(matrix);
  const { rows, columns } = validated;
  const source = validated.values;

  const visited = new Uint8Array(rows * columns);
  const queue: number[] = [];

  const seedIfBackground = (row: number, column: number) => {
    const index = row * columns + column;
    if (source[index] === 0 && visited[index] === 0) {
      visited[index] = 1;
      queue.push(index);
    }
  };

  for (let column = 0; column < columns; column += 1) {
    seedIfBackground(0, column);
    seedIfBackground(rows - 1, column);
  }
  for (let row = 1; row < rows - 1; row += 1) {
    seedIfBackground(row, 0);
    seedIfBackground(row, columns - 1);
  }

  while (queue.length > 0) {
    const index = queue.pop() as number;
    const row = Math.floor(index / columns);
    const column = index % columns;

    if (row > 0) seedIfBackground(row - 1, column);
    if (row < rows - 1) seedIfBackground(row + 1, column);
    if (column > 0) seedIfBackground(row, column - 1);
    if (column < columns - 1) seedIfBackground(row, column + 1);
  }

  const values = source.map((value, index) => (
    value === 1 || visited[index] === 0 ? 1 : 0
  ));

  return {
    rows,
    columns,
    values,
  };
}
