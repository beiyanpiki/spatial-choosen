import { describe, expect, it } from 'vitest';

import type { TissueActivationMatrix, TissueActivationValue } from '@/types/preprocess';

import { deriveFilledTissueMatrix } from './tissueFill';
import { createEmptyMatrix } from './tissueMatrix';

const toMatrix = (rows: number, columns: number, lines: string[]): TissueActivationMatrix => {
  const values: TissueActivationValue[] = [];
  for (const line of lines) {
    for (const char of line) {
      if (char !== '#' && char !== '.') {
        throw new Error(`Unexpected matrix literal character: ${char}`);
      }
      values.push(char === '#' ? 1 : 0);
    }
  }

  return {
    rows,
    columns,
    values,
  };
};

const toLiteral = (matrix: TissueActivationMatrix): string[] => {
  const lines: string[] = [];
  for (let row = 0; row < matrix.rows; row += 1) {
    lines.push(
      matrix.values
        .slice(row * matrix.columns, (row + 1) * matrix.columns)
        .map((value) => (value === 1 ? '#' : '.'))
        .join(''),
    );
  }

  return lines;
};

describe('deriveFilledTissueMatrix', () => {
  it('fills the hole enclosed by a single contour', () => {
    const matrix = toMatrix(3, 4, [
      '.##.',
      '#..#',
      '.##.',
    ]);

    expect(toLiteral(deriveFilledTissueMatrix(matrix))).toEqual([
      '.##.',
      '####',
      '.##.',
    ]);
  });

  it('fills the interior of each disjoint contour independently', () => {
    // Two separate detected tissue regions, each with its own interior gap —
    // one auto-detection run can outline several tissue sections at once.
    const matrix = toMatrix(5, 11, [
      '...........',
      '.####..###.',
      '.#..#..#.#.',
      '.####..###.',
      '...........',
    ]);

    expect(toLiteral(deriveFilledTissueMatrix(matrix))).toEqual([
      '...........',
      '.####..###.',
      '.####..###.',
      '.####..###.',
      '...........',
    ]);
  });

  it('keeps background that is reachable from the matrix border', () => {
    // The ring is open on the right, so its center is outside-reachable and
    // must stay background.
    const matrix = toMatrix(3, 5, [
      '.##..',
      '.#...',
      '.##..',
    ]);

    expect(toLiteral(deriveFilledTissueMatrix(matrix))).toEqual([
      '.##..',
      '.#...',
      '.##..',
    ]);
  });

  it('treats corner-touching selections as a closed contour', () => {
    const matrix = toMatrix(3, 3, [
      '.#.',
      '#.#',
      '.#.',
    ]);

    expect(toLiteral(deriveFilledTissueMatrix(matrix))).toEqual([
      '.#.',
      '###',
      '.#.',
    ]);
  });

  it('fills the whole interior when the selection closes the outer ring', () => {
    const matrix = toMatrix(5, 5, [
      '#####',
      '#...#',
      '#.#.#',
      '#...#',
      '#####',
    ]);

    expect(toLiteral(deriveFilledTissueMatrix(matrix))).toEqual([
      '#####',
      '#####',
      '#####',
      '#####',
      '#####',
    ]);
  });

  it('returns an all-zero matrix unchanged', () => {
    const matrix = createEmptyMatrix(3, 5);

    expect(deriveFilledTissueMatrix(matrix)).toEqual(matrix);
  });

  it('returns an all-selected matrix unchanged', () => {
    const matrix: TissueActivationMatrix = {
      rows: 2,
      columns: 2,
      values: [1, 1, 1, 1],
    };

    expect(deriveFilledTissueMatrix(matrix)).toEqual(matrix);
  });

  it('handles a one-dimensional matrix', () => {
    const matrix: TissueActivationMatrix = {
      rows: 1,
      columns: 4,
      values: [0, 1, 0, 1],
    };

    expect(toLiteral(deriveFilledTissueMatrix(matrix))).toEqual(['.#.#']);
  });

  it('produces an independent matrix and never mutates the input', () => {
    const matrix = toMatrix(3, 3, [
      '.#.',
      '#.#',
      '.#.',
    ]);
    const inputSnapshot = [...matrix.values];

    const filled = deriveFilledTissueMatrix(matrix);

    expect(filled).not.toBe(matrix);
    expect(filled.values).not.toBe(matrix.values);
    expect(matrix.values).toEqual(inputSnapshot);
    expect(matrix.values[4]).toBe(0);
    expect(filled.values[4]).toBe(1);
  });

  it('rejects an invalid matrix', () => {
    const matrix = {
      rows: 2,
      columns: 2,
      values: [0, 1, 0, 2],
    } as unknown as TissueActivationMatrix;

    expect(() => deriveFilledTissueMatrix(matrix)).toThrow(/binary/i);
  });
});
