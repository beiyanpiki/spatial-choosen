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
	it("prefers eosinReferenceGeometry and maps to emitted fullres frame bounds", () => {
		expect(
			resolveSpotExportGeometry({
				templateEntries,
				cropQc: {
					eosinReferenceGeometry: {
						// eosinReferenceGeometry describes crop region in eosin space
						// It maps to the emitted HE fullres export frame
						rect: {
							x: 0.1,
							y: 0.1,
							width: 0.8,
							height: 0.8,
						},
						width: 1000,
						height: 800,
					},
					heQcGeometry: {
						// heQcGeometry is ignored when eosinReferenceGeometry is present
						rect: { x: 0, y: 0, width: 1, height: 1 },
						width: 400,
						height: 300,
					},
				},
				exportFullresWidth: 400,
				exportFullresHeight: 300,
			}),
		).toEqual({
				chipRect: {
						// Emitted fullres frame bounds - eosinReferenceGeometry maps to the entire export image
					x: 0,
					y: 0,
					width: 400,
					height: 300,
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
						// Normalized coordinates - will be multiplied by exportFullresWidth/exportFullresHeight
						rect: {
							x: 12 / 400,
							y: 18 / 300,
							width: 350 / 400,
							height: 250 / 300,
						},
						width: 350,
						height: 250,
					},
				},
				exportFullresWidth: 400,
				exportFullresHeight: 300,
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

	it("falls back to emitted fullres frame bounds when both geometries are absent", () => {
		expect(
			resolveSpotExportGeometry({
				templateEntries,
				cropQc: {
					eosinReferenceGeometry: null,
					heQcGeometry: null,
				},
				exportFullresWidth: 400,
				exportFullresHeight: 300,
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
						// Normalized coordinates - will be multiplied by exportFullresWidth/exportFullresHeight
						rect: {
							x: 75 / 250,
							y: 75 / 250,
							width: 100 / 250,
							height: 100 / 250,
						},
						width: 100,
						height: 100,
					},
				},
				exportFullresWidth: 250,
				exportFullresHeight: 250,
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

	it("maps template coordinates to the emitted fullres export frame when using eosinReferenceGeometry", () => {
		// eosinReferenceGeometry maps to the emitted fullres export frame, ignoring rect values
		expect(
			resolveSpotExportFullresLayout({
				templateEntries,
				chipManifest: exportChip50um,
				cropQc: {
					eosinReferenceGeometry: {
						// eosinReferenceGeometry maps to the emitted fullres export frame, rect values ignored
						rect: { x: 0, y: 0, width: 1, height: 1 },
						width: 1000,
						height: 800,
					},
					// heQcGeometry is ignored when eosinReferenceGeometry is present
					heQcGeometry: null,
				},
				exportFullresWidth: 500,
				exportFullresHeight: 500,
			}).spotCenters,
		).toEqual([
			{
				barcode: "spot-a",
				arrayRow: 1,
				arrayCol: 1,
				// Template min (75, 75) maps to the emitted fullres export frame (0, 0)
				pxl_row_in_fullres: 0,
				pxl_col_in_fullres: 0,
			},
			{
				barcode: "spot-b",
				arrayRow: 1,
				arrayCol: 2,
				// Row: min = 0, Col: (175-75)/(175-75)*500 = exportFullresWidth
				pxl_row_in_fullres: 0,
				pxl_col_in_fullres: 500,
			},
			{
				barcode: "spot-c",
				arrayRow: 2,
				arrayCol: 1,
				// Row: (175-75)/(175-75)*500 = exportFullresHeight, Col: min = 0
				pxl_row_in_fullres: 500,
				pxl_col_in_fullres: 0,
			},
			{
				barcode: "spot-d",
				arrayRow: 2,
				arrayCol: 2,
				// Template max (175, 175) maps to the emitted fullres export frame (500, 500)
				pxl_row_in_fullres: 500,
				pxl_col_in_fullres: 500,
			},
		]);
	});

	it("maps intermediate anchors proportionally within an asymmetric emitted fullres export frame", () => {
		const asymmetricTemplateEntries: ChipTemplateEntry[] = [
			{ barcode: "spot-a", arrayRow: 1, arrayCol: 1, pxl_row_in_fullres: 75, pxl_col_in_fullres: 75 },
			{ barcode: "spot-b", arrayRow: 1, arrayCol: 2, pxl_row_in_fullres: 75, pxl_col_in_fullres: 125 },
			{ barcode: "spot-c", arrayRow: 1, arrayCol: 3, pxl_row_in_fullres: 75, pxl_col_in_fullres: 175 },
			{ barcode: "spot-d", arrayRow: 2, arrayCol: 1, pxl_row_in_fullres: 125, pxl_col_in_fullres: 75 },
			{ barcode: "spot-e", arrayRow: 2, arrayCol: 2, pxl_row_in_fullres: 125, pxl_col_in_fullres: 125 },
			{ barcode: "spot-f", arrayRow: 2, arrayCol: 3, pxl_row_in_fullres: 125, pxl_col_in_fullres: 175 },
			{ barcode: "spot-g", arrayRow: 3, arrayCol: 1, pxl_row_in_fullres: 175, pxl_col_in_fullres: 75 },
			{ barcode: "spot-h", arrayRow: 3, arrayCol: 2, pxl_row_in_fullres: 175, pxl_col_in_fullres: 125 },
			{ barcode: "spot-i", arrayRow: 3, arrayCol: 3, pxl_row_in_fullres: 175, pxl_col_in_fullres: 175 },
		];

		expect(
			resolveSpotExportFullresLayout({
				templateEntries: asymmetricTemplateEntries,
				chipManifest: exportChip50um,
				cropQc: {
					eosinReferenceGeometry: {
						rect: { x: 0, y: 0, width: 1, height: 1 },
						width: 1000,
						height: 800,
					},
					heQcGeometry: null,
				},
				exportFullresWidth: 640,
				exportFullresHeight: 320,
			}),
		).toEqual({
			chipRect: {
				x: 0,
				y: 0,
				width: 640,
				height: 320,
			},
			chipRectSource: "eosin-reference-geometry",
			templateAnchorBounds: {
				minPxlRowInFullres: 75,
				maxPxlRowInFullres: 175,
				minPxlColInFullres: 75,
				maxPxlColInFullres: 175,
			},
			templateAnchors: asymmetricTemplateEntries,
			spotCenters: [
				{ barcode: "spot-a", arrayRow: 1, arrayCol: 1, pxl_row_in_fullres: 0, pxl_col_in_fullres: 0 },
				{ barcode: "spot-b", arrayRow: 1, arrayCol: 2, pxl_row_in_fullres: 0, pxl_col_in_fullres: 320 },
				{ barcode: "spot-c", arrayRow: 1, arrayCol: 3, pxl_row_in_fullres: 0, pxl_col_in_fullres: 640 },
				{ barcode: "spot-d", arrayRow: 2, arrayCol: 1, pxl_row_in_fullres: 160, pxl_col_in_fullres: 0 },
				{ barcode: "spot-e", arrayRow: 2, arrayCol: 2, pxl_row_in_fullres: 160, pxl_col_in_fullres: 320 },
				{ barcode: "spot-f", arrayRow: 2, arrayCol: 3, pxl_row_in_fullres: 160, pxl_col_in_fullres: 640 },
				{ barcode: "spot-g", arrayRow: 3, arrayCol: 1, pxl_row_in_fullres: 320, pxl_col_in_fullres: 0 },
				{ barcode: "spot-h", arrayRow: 3, arrayCol: 2, pxl_row_in_fullres: 320, pxl_col_in_fullres: 320 },
				{ barcode: "spot-i", arrayRow: 3, arrayCol: 3, pxl_row_in_fullres: 320, pxl_col_in_fullres: 640 },
			],
			squareSideLength: 120,
		});
	});

	it("rounds transformed non-integer export centers to integer pixels at the final export stage", () => {
		expect(
			resolveSpotExportFullresLayout({
				templateEntries,
				chipManifest: exportChip50um,
				cropQc: {
					heQcGeometry: {
						// Normalized coordinates - will be multiplied by exportFullresWidth/exportFullresHeight
						rect: {
							x: 35.4 / 500,
							y: 80.6 / 500,
							width: 150.2 / 500,
							height: 240.2 / 500,
						},
						width: 150.2,
						height: 240.2,
					},
				},
				exportFullresWidth: 500,
				exportFullresHeight: 500,
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

	it("derives export-side square diameter from the corrected fullres-frame pitch formula", () => {
		const exportLayout = resolveSpotExportFullresLayout({
			templateEntries,
			chipManifest: exportChip50um,
			cropQc: {
				heQcGeometry: {
					// Normalized coordinates - will be multiplied by exportFullresWidth/exportFullresHeight
					rect: {
						x: 35 / 500,
						y: 80 / 500,
						width: 150 / 500,
						height: 240 / 500,
					},
					width: 150,
					height: 240,
				},
			},
			exportFullresWidth: 500,
			exportFullresHeight: 500,
		});

		// ((240 + 150) / 2) * 0.5 = 97.5 for the 50um 50/50 manifest.
		expect(exportLayout.squareSideLength).toBe(97.5);
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
					// Normalized coordinates - will be multiplied by exportFullresWidth/exportFullresHeight
					rect: {
						x: 33 / 100,
						y: 33 / 100,
						width: 40 / 100,
						height: 40 / 100,
					},
					width: 40,
					height: 40,
				},
			},
			exportFullresWidth: 100,
			exportFullresHeight: 100,
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
					// Normalized coordinates - will be multiplied by exportFullresWidth/exportFullresHeight
					rect: {
						x: 35 / 500,
						y: 80 / 500,
						width: 150 / 500,
						height: 240 / 500,
					},
					width: 150,
					height: 240,
				},
			},
			exportFullresWidth: 500,
			exportFullresHeight: 500,
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
					// Normalized coordinates - will be multiplied by exportFullresWidth/exportFullresHeight
					rect: {
						x: 35 / 500,
						y: 80 / 500,
						width: 150 / 500,
						height: 240 / 500,
					},
					width: 150,
					height: 240,
				},
			},
			exportFullresWidth: 500,
			exportFullresHeight: 500,
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
