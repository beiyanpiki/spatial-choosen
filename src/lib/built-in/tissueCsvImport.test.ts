import { describe, expect, it } from 'vitest';

import { parseTissueActivationCsv } from './tissueCsvImport';

const activeCount = (values: number[]) => values.filter((value) => value === 1).length;

describe('parseTissueActivationCsv', () => {
	it('parses the processed sample format into a 96x96 15um matrix', () => {
		const csv = [
			'barcode,Log2_nGene_Spatial,tissue,row,col',
			'BC-TL,9.5,1,1,1',
			'BC-BR,10.1,1,96,96',
			'BC-MID,8.2,0,50,50',
		].join('\n');

		const result = parseTissueActivationCsv(csv);

		expect(result.chipType).toBe('15um');
		expect(result.rows).toBe(96);
		expect(result.columns).toBe(96);
		expect(result.matrix.values).toHaveLength(96 * 96);
		expect(activeCount(result.matrix.values)).toBe(2);
	});

	it('maps csv rows to matrix cells with the bottom-left row flip', () => {
		// csv (1,1) is the TOP-left cell. After the flip it lands in the matrix's
		// bottom row: arrayRow = 96, index = (96-1)*96 + 0 = 9120.
		// csv (96,96) is the BOTTOM-right cell -> matrix arrayRow = 1, index = 95.
		const csv = [
			'barcode,Log2_nGene_Spatial,tissue,row,col',
			'BC-TL,9.5,1,1,1',
			'BC-BR,10.1,1,96,96',
		].join('\n');

		const { matrix } = parseTissueActivationCsv(csv);

		expect(matrix.values[9120]).toBe(1);
		expect(matrix.values[95]).toBe(1);
		// A neighbouring cell must remain inactive.
		expect(matrix.values[0]).toBe(0);
		expect(matrix.values[9215]).toBe(0);
	});

	it('infers 50um from a 64x64 grid', () => {
		const csv = [
			'barcode,tissue,row,col',
			'BC,1,1,1',
			'BC2,0,64,64',
		].join('\n');

		const result = parseTissueActivationCsv(csv);

		expect(result.chipType).toBe('50um');
		expect(result.rows).toBe(64);
		expect(result.columns).toBe(64);
		expect(activeCount(result.matrix.values)).toBe(1);
	});

	it('treats grid cells absent from the CSV as inactive', () => {
		const csv = [
			'barcode,tissue,row,col',
			'BC,1,1,1',
			'BC2,1,96,96',
			'BC3,0,10,10',
		].join('\n');

		const { matrix } = parseTissueActivationCsv(csv);

		// Only two active cells were specified; the 9214 unspecified cells stay 0.
		expect(activeCount(matrix.values)).toBe(2);
	});

	it('accepts the standard export column names (in_tissue / array_row / array_col)', () => {
		const csv = [
			'barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres',
			'BC,1,1,1,10,10',
			'BC2,0,96,96,20,20',
		].join('\n');

		const result = parseTissueActivationCsv(csv);

		expect(result.chipType).toBe('15um');
		expect(result.matrix.values[9120]).toBe(1);
	});

	it('is case-insensitive and tolerant of whitespace in the header', () => {
		const csv = [
			' Barcode , Tissue , Row , Col ',
			'BC,1,1,1',
			'BC2,0,96,96',
		].join('\n');

		const result = parseTissueActivationCsv(csv);

		expect(result.chipType).toBe('15um');
		expect(activeCount(result.matrix.values)).toBe(1);
	});

	it('throws on an empty file', () => {
		expect(() => parseTissueActivationCsv('')).toThrow(/empty/);
	});

	it('throws when there are no data rows', () => {
		expect(() => parseTissueActivationCsv('barcode,tissue,row,col')).toThrow(/no data rows/);
	});

	it('throws when a required column is missing', () => {
		const csv = ['barcode,row,col', 'BC,1,1', 'BC2,0,96,96'].join('\n');
		expect(() => parseTissueActivationCsv(csv)).toThrow(/missing required columns/);
	});

	it('throws on an unknown chip grid', () => {
		const csv = ['barcode,tissue,row,col', 'BC,1,1,1', 'BC2,0,50,50'].join('\n');
		expect(() => parseTissueActivationCsv(csv)).toThrow(/Cannot infer chip type/);
	});

	it('throws on a non-binary tissue value', () => {
		const csv = ['barcode,tissue,row,col', 'BC,2,1,1', 'BC2,0,96,96'].join('\n');
		expect(() => parseTissueActivationCsv(csv)).toThrow(/non-binary tissue value/);
	});

	it('throws on a non-integer coordinate', () => {
		const csv = ['barcode,tissue,row,col', 'BC,1,abc,1', 'BC2,0,96,96'].join('\n');
		expect(() => parseTissueActivationCsv(csv)).toThrow(/non-integer row\/col/);
	});
});
