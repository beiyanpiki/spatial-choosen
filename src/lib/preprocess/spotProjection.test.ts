import { describe, expect, it } from "vitest";
import type { ChipConfigManifest, ChipTemplateEntry } from "./chipConfigs";
import {
	getProjectedSpotLowresBounds,
	projectSpotsForCrop,
	resolveAuthoritativeSpotDiameterFullres,
	resolveSpotExportFullresDiameter,
	resolveSpotExportFullresLayout,
	resolveSpotExportGeometry,
} from "./spotProjection";

const chip: ChipConfigManifest = {
	id: "15um",
	label: "Test chip",
	gridRows: 2,
	gridCols: 2,
	spotDiameter: 10,
	spotGap: 4,
	barcodeTemplatePath: "/unused/template.csv",
	tissuePositionsPath: "/unused/tissue.csv",
};

const templateEntries: ChipTemplateEntry[] = [
	{
		barcode: "spot-a",
		arrayRow: 1,
		arrayCol: 1,
		pxl_row_in_fullres: 75,
		pxl_col_in_fullres: 75,
	},
	{
		barcode: "spot-b",
		arrayRow: 1,
		arrayCol: 2,
		pxl_row_in_fullres: 75,
		pxl_col_in_fullres: 175,
	},
	{
		barcode: "spot-c",
		arrayRow: 2,
		arrayCol: 1,
		pxl_row_in_fullres: 175,
		pxl_col_in_fullres: 75,
	},
	{
		barcode: "spot-d",
		arrayRow: 2,
		arrayCol: 2,
		pxl_row_in_fullres: 175,
		pxl_col_in_fullres: 175,
	},
];

const exportChip50um = {
	spotDiameter: 50,
	spotGap: 50,
} as const;

const exportChip15um = {
	spotDiameter: 25,
	spotGap: 15,
} as const;

describe("spot export geometry contract", () => {
	it("prefers eosinReferenceGeometry rect when present", () => {
		expect(
			resolveSpotExportGeometry({
				templateEntries,
				cropQc: {
					eosinReferenceGeometry: {
						rect: {
							x: 12,
							y: 18,
							width: 340,
							height: 240,
						},
						width: 340,
						height: 240,
					},
					heQcGeometry: {
						rect: {
							x: 1,
							y: 2,
							width: 350,
							height: 250,
						},
						width: 350,
						height: 250,
					},
				},
				cropWidth: 400,
				cropHeight: 300,
			}),
		).toEqual({
				chipRect: {
					x: 12,
					y: 18,
					width: 340,
					height: 240,
				},
				chipRectSource: "eosin-reference-geometry",
				templateAnchorBounds: {
					minPxlRowInFullres: 75,
					maxPxlRowInFullres: 175,
				minPxlColInFullres: 75,
				maxPxlColInFullres: 175,
			},
			templateAnchors: templateEntries,
		});
	});

	it("falls back to heQcGeometry rect when eosinReferenceGeometry is absent", () => {
		expect(
			resolveSpotExportGeometry({
				templateEntries,
				cropQc: {
					eosinReferenceGeometry: null,
					heQcGeometry: {
						rect: {
							x: 12,
							y: 18,
							width: 350,
							height: 250,
						},
						width: 350,
						height: 250,
					},
				},
				cropWidth: 400,
				cropHeight: 300,
			}),
		).toEqual({
			chipRect: {
				x: 12,
				y: 18,
				width: 350,
				height: 250,
			},
			chipRectSource: "he-qc-geometry",
			templateAnchorBounds: {
				minPxlRowInFullres: 75,
				maxPxlRowInFullres: 175,
				minPxlColInFullres: 75,
				maxPxlColInFullres: 175,
			},
			templateAnchors: templateEntries,
		});
	});

	it("falls back to full crop bounds when both geometries are absent", () => {
		expect(
			resolveSpotExportGeometry({
				templateEntries,
				cropQc: {
					eosinReferenceGeometry: null,
					heQcGeometry: null,
				},
				cropWidth: 400,
				cropHeight: 300,
			}),
		).toEqual({
			chipRect: {
				x: 0,
				y: 0,
				width: 400,
				height: 300,
			},
			chipRectSource: "crop-bounds-fallback",
			templateAnchorBounds: {
				minPxlRowInFullres: 75,
				maxPxlRowInFullres: 175,
				minPxlColInFullres: 75,
				maxPxlColInFullres: 175,
			},
			templateAnchors: templateEntries,
		});
	});
});

describe("spot export fullres layout", () => {
	it("emits canonical identity fixture centers when the export chip rect matches the retained anchor bounds", () => {
		expect(
			resolveSpotExportFullresLayout({
				templateEntries,
				chipManifest: exportChip50um,
				cropQc: {
					heQcGeometry: {
						rect: {
							x: 75,
							y: 75,
							width: 100,
							height: 100,
						},
						width: 100,
						height: 100,
					},
				},
				cropWidth: 250,
				cropHeight: 250,
			}),
		).toEqual({
			chipRect: {
				x: 75,
				y: 75,
				width: 100,
				height: 100,
			},
			chipRectSource: "he-qc-geometry",
			templateAnchorBounds: {
				minPxlRowInFullres: 75,
				maxPxlRowInFullres: 175,
				minPxlColInFullres: 75,
				maxPxlColInFullres: 175,
			},
			templateAnchors: templateEntries,
			spotCenters: [
				{
					barcode: "spot-a",
					arrayRow: 1,
					arrayCol: 1,
					pxl_row_in_fullres: 75,
					pxl_col_in_fullres: 75,
				},
				{
					barcode: "spot-b",
					arrayRow: 1,
					arrayCol: 2,
					pxl_row_in_fullres: 75,
					pxl_col_in_fullres: 175,
				},
				{
					barcode: "spot-c",
					arrayRow: 2,
					arrayCol: 1,
					pxl_row_in_fullres: 175,
					pxl_col_in_fullres: 75,
				},
				{
					barcode: "spot-d",
					arrayRow: 2,
					arrayCol: 2,
					pxl_row_in_fullres: 175,
					pxl_col_in_fullres: 175,
				},
			],
			squareSideLength: 50,
		});
	});

	it("maps transformed export centers in the eosin image frame", () => {
		expect(
			resolveSpotExportFullresLayout({
				templateEntries,
				chipManifest: exportChip50um,
				cropQc: {
					eosinReferenceGeometry: {
						rect: {
							x: 24,
							y: 96,
							width: 180,
							height: 120,
						},
						width: 180,
						height: 120,
					},
					heQcGeometry: {
						rect: {
							x: 5,
							y: 10,
							width: 150,
							height: 240,
						},
						width: 150,
						height: 240,
					},
				},
				cropWidth: 500,
				cropHeight: 500,
			}).spotCenters,
		).toEqual([
			{
				barcode: "spot-a",
				arrayRow: 1,
				arrayCol: 1,
				pxl_row_in_fullres: 96,
				pxl_col_in_fullres: 24,
			},
			{
				barcode: "spot-b",
				arrayRow: 1,
				arrayCol: 2,
				pxl_row_in_fullres: 96,
				pxl_col_in_fullres: 204,
			},
			{
				barcode: "spot-c",
				arrayRow: 2,
				arrayCol: 1,
				pxl_row_in_fullres: 216,
				pxl_col_in_fullres: 24,
			},
			{
				barcode: "spot-d",
				arrayRow: 2,
				arrayCol: 2,
				pxl_row_in_fullres: 216,
				pxl_col_in_fullres: 204,
			},
		]);
	});

	it("rounds transformed non-integer export centers to integer pixels at the final export stage", () => {
		expect(
			resolveSpotExportFullresLayout({
				templateEntries,
				chipManifest: exportChip50um,
				cropQc: {
					heQcGeometry: {
						rect: {
							x: 35.4,
							y: 80.6,
							width: 150.2,
							height: 240.2,
						},
						width: 150.2,
						height: 240.2,
					},
				},
				cropWidth: 500,
				cropHeight: 500,
			}).spotCenters,
		).toEqual([
			{
				barcode: "spot-a",
				arrayRow: 1,
				arrayCol: 1,
				pxl_row_in_fullres: 81,
				pxl_col_in_fullres: 35,
			},
			{
				barcode: "spot-b",
				arrayRow: 1,
				arrayCol: 2,
				pxl_row_in_fullres: 81,
				pxl_col_in_fullres: 186,
			},
			{
				barcode: "spot-c",
				arrayRow: 2,
				arrayCol: 1,
				pxl_row_in_fullres: 321,
				pxl_col_in_fullres: 35,
			},
			{
				barcode: "spot-d",
				arrayRow: 2,
				arrayCol: 2,
				pxl_row_in_fullres: 321,
				pxl_col_in_fullres: 186,
			},
		]);
	});

	it("derives export-side square diameter from the same geometry contract", () => {
		expect(
			resolveSpotExportFullresLayout({
				templateEntries,
				chipManifest: exportChip50um,
				cropQc: {
					heQcGeometry: {
						rect: {
							x: 35,
							y: 80,
							width: 150,
							height: 240,
						},
						width: 150,
						height: 240,
					},
				},
				cropWidth: 500,
				cropHeight: 500,
			}).squareSideLength,
		).toBe(97.5);
	});

	it("uses shipped 15um manifest ratios so fallback diameter is 25 instead of half-pitch 20", () => {
		const templateEntries15um: ChipTemplateEntry[] = [
			{ barcode: "15um-001-001", arrayRow: 1, arrayCol: 1, pxl_row_in_fullres: 33, pxl_col_in_fullres: 33 },
			{ barcode: "15um-001-002", arrayRow: 1, arrayCol: 2, pxl_row_in_fullres: 33, pxl_col_in_fullres: 73 },
			{ barcode: "15um-002-001", arrayRow: 2, arrayCol: 1, pxl_row_in_fullres: 73, pxl_col_in_fullres: 33 },
			{ barcode: "15um-002-002", arrayRow: 2, arrayCol: 2, pxl_row_in_fullres: 73, pxl_col_in_fullres: 73 },
		];

		const exportLayout = resolveSpotExportFullresLayout({
			templateEntries: templateEntries15um,
			chipManifest: exportChip15um,
			cropQc: {
				heQcGeometry: {
					rect: {
						x: 33,
						y: 33,
						width: 40,
						height: 40,
					},
					width: 40,
					height: 40,
				},
			},
			cropWidth: 100,
			cropHeight: 100,
		});

		expect(exportLayout.spotCenters).toEqual([
			{ barcode: "15um-001-001", arrayRow: 1, arrayCol: 1, pxl_row_in_fullres: 33, pxl_col_in_fullres: 33 },
			{ barcode: "15um-001-002", arrayRow: 1, arrayCol: 2, pxl_row_in_fullres: 33, pxl_col_in_fullres: 73 },
			{ barcode: "15um-002-001", arrayRow: 2, arrayCol: 1, pxl_row_in_fullres: 73, pxl_col_in_fullres: 33 },
			{ barcode: "15um-002-002", arrayRow: 2, arrayCol: 2, pxl_row_in_fullres: 73, pxl_col_in_fullres: 73 },
		]);
		expect(exportLayout.squareSideLength).toBe(25);
		expect(
			resolveSpotExportFullresDiameter({ persistedSpotDiameterFullres: null, exportLayout }),
		).toBe(25);
	});
});

describe("spot projection canonical crop contract", () => {
	it("keeps projected spot centers and lowres bounds stable for tissue consumers", () => {
		const projectedSpots = projectSpotsForCrop({
			chip,
			templateEntries,
			cropWidth: 400,
			cropHeight: 400,
		});

		expect(projectedSpots).toEqual([
			{
				id: "spot-a",
				barcode: "spot-a",
				arrayRow: 1,
				arrayCol: 1,
				x: 0.28125,
				y: 0.28125,
				width: 0.3125,
				height: 0.3125,
				diameterX: 0.3125,
				diameterY: 0.3125,
			},
			{
				id: "spot-b",
				barcode: "spot-b",
				arrayRow: 1,
				arrayCol: 2,
				x: 0.71875,
				y: 0.28125,
				width: 0.3125,
				height: 0.3125,
				diameterX: 0.3125,
				diameterY: 0.3125,
			},
			{
				id: "spot-c",
				barcode: "spot-c",
				arrayRow: 2,
				arrayCol: 1,
				x: 0.28125,
				y: 0.71875,
				width: 0.3125,
				height: 0.3125,
				diameterX: 0.3125,
				diameterY: 0.3125,
			},
			{
				id: "spot-d",
				barcode: "spot-d",
				arrayRow: 2,
				arrayCol: 2,
				x: 0.71875,
				y: 0.71875,
				width: 0.3125,
				height: 0.3125,
				diameterX: 0.3125,
				diameterY: 0.3125,
			},
		]);

		expect(
			getProjectedSpotLowresBounds({
				spot: projectedSpots[0],
				cropWidth: 400,
				cropHeight: 400,
				tissue_lowres_scalef: 0.25,
			}),
		).toEqual({
			startX: 12,
			endX: 44,
			startY: 12,
			endY: 44,
		});
	});

	it("keeps a valid persisted export diameter ahead of export geometry fallback", () => {
		const exportLayout = resolveSpotExportFullresLayout({
			templateEntries,
			chipManifest: exportChip50um,
			cropQc: {
				heQcGeometry: {
					rect: {
						x: 35,
						y: 80,
						width: 150,
						height: 240,
					},
					width: 150,
					height: 240,
				},
			},
			cropWidth: 500,
			cropHeight: 500,
		});

		expect(
			resolveSpotExportFullresDiameter({
				persistedSpotDiameterFullres: 18,
				exportLayout,
			}),
		).toBe(18);
	});

	it("falls back to export geometry square side length when persisted diameter is absent", () => {
		const exportLayout = resolveSpotExportFullresLayout({
			templateEntries,
			chipManifest: exportChip50um,
			cropQc: {
				heQcGeometry: {
					rect: {
						x: 35,
						y: 80,
						width: 150,
						height: 240,
					},
					width: 150,
					height: 240,
				},
			},
			cropWidth: 500,
			cropHeight: 500,
		});

		expect(
			resolveSpotExportFullresDiameter({
				persistedSpotDiameterFullres: null,
				exportLayout,
			}),
		).toBe(97.5);
	});

	it("remains source-agnostic once downstream work is reduced to canonical crop dimensions", () => {
		const automaticAcceptedProjection = projectSpotsForCrop({
			chip,
			templateEntries,
			cropWidth: 400,
			cropHeight: 300,
		});

		const manualAcceptedProjection = projectSpotsForCrop({
			chip,
			templateEntries,
			cropWidth: 400,
			cropHeight: 300,
		});

		expect(automaticAcceptedProjection).toEqual(manualAcceptedProjection);
		expect(
			resolveAuthoritativeSpotDiameterFullres({
				projectedSpots: automaticAcceptedProjection,
				cropWidth: 400,
				cropHeight: 300,
			}),
		).toBe(
			resolveAuthoritativeSpotDiameterFullres({
				projectedSpots: manualAcceptedProjection,
				cropWidth: 400,
				cropHeight: 300,
			}),
		);
	});
});
