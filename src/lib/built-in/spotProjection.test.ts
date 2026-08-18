import { describe, expect, it } from "vitest";
import type { ChipConfigManifest, ChipTemplateEntry } from "./chipConfigs";
import { projectSpotsForCrop, projectSpotsForPlacement } from "./spotProjection";

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

describe("projectSpotsForCrop", () => {
	it("projects spot centers and normalized dimensions for the full image frame", () => {
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
	});

	it("is deterministic for the same chip and frame dimensions", () => {
		const firstProjection = projectSpotsForCrop({
			chip,
			templateEntries,
			cropWidth: 400,
			cropHeight: 300,
		});

		const secondProjection = projectSpotsForCrop({
			chip,
			templateEntries,
			cropWidth: 400,
			cropHeight: 300,
		});

		expect(firstProjection).toEqual(secondProjection);
	});
});

describe("projectSpotsForPlacement", () => {
	it("lays out a 2x2 grid at the placement scale in HE-normalized coordinates", () => {
		// rows=2, columns=2, spotDiameter=1, spotGap=1, scale=100 -> spotPx=gapPx=100.
		// Center of (1,1) = 100 + 50 = 150 HE px -> normalized 0.15; (1,2)/(2,1) at 350 -> 0.35.
		const spots = projectSpotsForPlacement({
			rows: 2,
			columns: 2,
			spotDiameter: 1,
			spotGap: 1,
			placement: { x: 0, y: 0, scale: 100 },
			heWidth: 1000,
			heHeight: 1000,
		});

		expect(spots).toHaveLength(4);
		expect(spots.map((spot) => spot.id).sort()).toEqual(["1:1", "1:2", "2:1", "2:2"]);

		const byId = new Map(spots.map((spot) => [spot.id, spot]));

		expect(byId.get("1:1")).toEqual({
			id: "1:1",
			barcode: "1:1",
			arrayRow: 1,
			arrayCol: 1,
			x: 0.15,
			y: 0.15,
			width: 0.1,
			height: 0.1,
			diameterX: 0.1,
			diameterY: 0.1,
		});
		expect(byId.get("1:2")?.arrayRow).toBe(1);
		expect(byId.get("1:2")?.arrayCol).toBe(2);
		expect(byId.get("1:2")?.x).toBeCloseTo(0.35, 10);
		expect(byId.get("1:2")?.y).toBeCloseTo(0.15, 10);
		expect(byId.get("2:1")?.x).toBeCloseTo(0.15, 10);
		expect(byId.get("2:1")?.y).toBeCloseTo(0.35, 10);
		expect(byId.get("2:2")?.x).toBeCloseTo(0.35, 10);
		expect(byId.get("2:2")?.y).toBeCloseTo(0.35, 10);
	});

	it("compacts excluded rows/columns while keeping the pitch", () => {
		// rows=3, cols=3, exclude row 1 and column 2: visible rows [2,3], visible cols [1,3].
		// Row 2 now occupies the FIRST slot (y=0.15) and row 3 the second (y=0.35):
		// the removed row is compressed, pitch (0.2) unchanged, block shrinks.
		const spots = projectSpotsForPlacement({
			rows: 3,
			columns: 3,
			spotDiameter: 1,
			spotGap: 1,
			placement: { x: 0, y: 0, scale: 100 },
			excludedRows: [1],
			excludedColumns: [2],
			heWidth: 1000,
			heHeight: 1000,
		});

		expect(spots).toHaveLength(4);
		expect(spots.map((spot) => spot.id).sort()).toEqual(["2:1", "2:3", "3:1", "3:3"]);
		expect(spots.some((spot) => spot.arrayRow === 1)).toBe(false);
		expect(spots.some((spot) => spot.arrayCol === 2)).toBe(false);

		const row21 = spots.find((spot) => spot.id === "2:1");
		const row31 = spots.find((spot) => spot.id === "3:1");
		expect(row21?.x).toBeCloseTo(0.15, 10);
		expect(row21?.y).toBeCloseTo(0.15, 10);
		expect(row31?.y).toBeCloseTo(0.35, 10);
		// Pitch between adjacent visible rows is unchanged (0.2).
		expect(row31!.y - row21!.y).toBeCloseTo(0.2, 10);
		// The compacted column skips to index 1: (2,3) is the second visible column.
		expect(spots.find((spot) => spot.id === "2:3")?.x).toBeCloseTo(0.35, 10);
	});

	it("keeps out-of-image spot coordinates unclamped", () => {
		const spots = projectSpotsForPlacement({
			rows: 2,
			columns: 2,
			spotDiameter: 1,
			spotGap: 1,
			placement: { x: 900, y: 0, scale: 100 },
			heWidth: 1000,
			heHeight: 1000,
		});
		const first = spots.find((spot) => spot.id === "1:1");
		expect(first).toBeDefined();
		// Center = 900 + 150 = 1050 HE px -> x = 1.05 (beyond the image, not clamped).
		expect(first!.x).toBeCloseTo(1.05, 10);
	});

	it("returns no spots when the placement scale is missing", () => {
		expect(
			projectSpotsForPlacement({
				rows: 2,
				columns: 2,
				spotDiameter: 1,
				spotGap: 1,
				placement: { x: 0, y: 0, scale: 0 },
				heWidth: 1000,
				heHeight: 1000,
			}),
		).toEqual([]);
	});
});
