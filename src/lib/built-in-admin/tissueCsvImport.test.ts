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

	it('throws on a grid exceeding the largest supported chip', () => {
		const csv = ['barcode,tissue,row,col', 'BC,1,1,1', 'BC2,0,100,100'].join('\n');
		expect(() => parseTissueActivationCsv(csv)).toThrow(/Cannot infer chip type/);
	});

	it('infers the containing chip for trimmed grids (63x64 -> 50um)', () => {
		const csv = [
			'barcode,tissue,row,col',
			'BC,1,1,1',
			'BC2,0,63,64',
		].join('\n');

		const result = parseTissueActivationCsv(csv);

		expect(result.chipType).toBe('50um');
		expect(result.rows).toBe(63);
		expect(result.columns).toBe(64);
	});

	it('infers the containing chip for export-compressed grids (92x96 -> 15um)', () => {
		const csv = [
			'barcode,tissue,row,col',
			'BC,1,1,1',
			'BC2,0,92,96',
		].join('\n');

		const result = parseTissueActivationCsv(csv);

		expect(result.chipType).toBe('15um');
		expect(result.rows).toBe(92);
		expect(result.columns).toBe(96);
	});

	it('throws on a non-binary tissue value', () => {
		const csv = ['barcode,tissue,row,col', 'BC,2,1,1', 'BC2,0,96,96'].join('\n');
		expect(() => parseTissueActivationCsv(csv)).toThrow(/non-binary tissue value/);
	});

	it('throws on a non-integer coordinate', () => {
		const csv = ['barcode,tissue,row,col', 'BC,1,abc,1', 'BC2,0,96,96'].join('\n');
		expect(() => parseTissueActivationCsv(csv)).toThrow(/invalid row coordinate/);
	});

	it('throws on an empty coordinate instead of silently dropping the row', () => {
		const csv = ['barcode,tissue,row,col', 'BC,1,,1', 'BC2,0,96,96'].join('\n');
		expect(() => parseTissueActivationCsv(csv)).toThrow(/empty row coordinate/);
	});

	it('throws on 0-based coordinates instead of silently dropping the row', () => {
		const csv = ['barcode,tissue,row,col', 'BC,1,0,1', 'BC2,0,96,96'].join('\n');
		expect(() => parseTissueActivationCsv(csv)).toThrow(/invalid row coordinate "0"/);
	});

	it('parses double-quoted fields with embedded commas', () => {
		const csv = [
			'barcode,tissue,row,col',
			'"BC,WEIRD-1",1,1,1',
			'BC2,0,96,96',
		].join('\n');

		const { barcodesByPosition } = parseTissueActivationCsv(csv);

		expect(barcodesByPosition['96:1']).toBe('BC,WEIRD-1');
	});

	it('captures Log2_nGene_Spatial keyed by the flipped in-memory position', () => {
		const csv = [
			'barcode,Log2_nGene_Spatial,tissue,row,col',
			'BC-TL,8.9,1,1,1',
			'BC-BR,10.1,0,96,96',
		].join('\n');

		const { log2nGeneByPosition } = parseTissueActivationCsv(csv);

		// csv (1,1) is the TOP-left cell; after the flip its in-memory position
		// is arrayRow 96, so the key is '96:1'.
		expect(log2nGeneByPosition['96:1']).toBe(8.9);
		// csv (96,96) -> in-memory position '1:96'.
		expect(log2nGeneByPosition['1:96']).toBe(10.1);
		expect(Object.keys(log2nGeneByPosition)).toHaveLength(2);
	});

	it('omits empty or non-numeric Log2_nGene_Spatial cells', () => {
		const csv = [
			'barcode,Log2_nGene_Spatial,tissue,row,col',
			'BC-OK,8.9,1,1,1',
			'BC-EMPTY,,1,96,96',
			'BC-BAD,not-a-number,1,50,50',
		].join('\n');

		const { log2nGeneByPosition } = parseTissueActivationCsv(csv);

		expect(Object.keys(log2nGeneByPosition)).toHaveLength(1);
		expect(log2nGeneByPosition['96:1']).toBe(8.9);
	});

	it('returns an empty Log2 map when the column is absent', () => {
		const csv = [
			'barcode,tissue,row,col',
			'BC,1,1,1',
			'BC2,0,96,96',
		].join('\n');

		const { log2nGeneByPosition } = parseTissueActivationCsv(csv);

		expect(log2nGeneByPosition).toEqual({});
	});

	it('captures barcodes keyed by the flipped in-memory position', () => {
		const csv = [
			'barcode,Log2_nGene_Spatial,tissue,row,col',
			'BC-TL,9.5,1,1,1',
			'BC-BR,10.1,1,96,96',
		].join('\n');

		const { barcodesByPosition } = parseTissueActivationCsv(csv);

		// csv (1,1) is the TOP-left cell; after the flip its in-memory position
		// is arrayRow 96 (bottom row), so the key is '96:1'.
		expect(barcodesByPosition['96:1']).toBe('BC-TL');
		// csv (96,96) is the BOTTOM-right cell -> in-memory position '1:96'.
		expect(barcodesByPosition['1:96']).toBe('BC-BR');
		expect(Object.keys(barcodesByPosition)).toHaveLength(2);
	});

	it('returns an empty barcode map when the barcode column is absent', () => {
		const csv = ['tissue,row,col', '1,1,1', '0,96,96'].join('\n');

		const { barcodesByPosition } = parseTissueActivationCsv(csv);

		expect(barcodesByPosition).toEqual({});
	});

	it('skips empty barcode cells', () => {
		const csv = [
			'barcode,tissue,row,col',
			'BC-TL,1,1,1',
			',0,96,96',
		].join('\n');

		const { barcodesByPosition } = parseTissueActivationCsv(csv);

		expect(barcodesByPosition['96:1']).toBe('BC-TL');
		expect(barcodesByPosition['1:96']).toBeUndefined();
	});

	it('throws on duplicate positions instead of silently overwriting', () => {
		const csv = [
			'barcode,tissue,row,col',
			'BC-OTHER,0,96,96',
			'BC-FIRST,1,1,1',
			'BC-SECOND,1,1,1',
		].join('\n');

		expect(() => parseTissueActivationCsv(csv)).toThrow(/duplicate position at row 1, col 1/);
	});
});
