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
	it("lays out a 2x2 grid inside the placement square in HE-normalized coordinates", () => {
		// rows=2, columns=2, spotDiameter=1, spotGap=1 -> blockExtent = 2*1 + 3*1 = 5.
		// placement size 1000 -> scale = 200, spotPx = 200, gapPx = 200.
		// Centers land at local 300/700 in HE pixels -> normalized 0.3/0.7 on a 1000x1000 HE.
		const spots = projectSpotsForPlacement({
			rows: 2,
			columns: 2,
			spotDiameter: 1,
			spotGap: 1,
			placement: { x: 0, y: 0, size: 1000 },
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
			x: 0.3,
			y: 0.3,
			width: 0.2,
			height: 0.2,
			diameterX: 0.2,
			diameterY: 0.2,
		});
		expect(byId.get("1:2")?.arrayRow).toBe(1);
		expect(byId.get("1:2")?.arrayCol).toBe(2);
		expect(byId.get("1:2")?.x).toBeCloseTo(0.7, 10);
		expect(byId.get("1:2")?.y).toBeCloseTo(0.3, 10);

		expect(byId.get("2:1")?.arrayRow).toBe(2);
		expect(byId.get("2:1")?.arrayCol).toBe(1);
		expect(byId.get("2:1")?.x).toBeCloseTo(0.3, 10);
		expect(byId.get("2:1")?.y).toBeCloseTo(0.7, 10);

		expect(byId.get("2:2")?.x).toBeCloseTo(0.7, 10);
		expect(byId.get("2:2")?.y).toBeCloseTo(0.7, 10);

		// Every normalized center is strictly inside (0, 1).
		for (const spot of spots) {
			expect(spot.x).toBeGreaterThan(0);
			expect(spot.x).toBeLessThan(1);
			expect(spot.y).toBeGreaterThan(0);
			expect(spot.y).toBeLessThan(1);
		}
	});

	it("moves and spreads the spots when the placement size grows", () => {
		const baseline = projectSpotsForPlacement({
			rows: 2,
			columns: 2,
			spotDiameter: 1,
			spotGap: 1,
			placement: { x: 0, y: 0, size: 1000 },
			heWidth: 1000,
			heHeight: 1000,
		});
		const grown = projectSpotsForPlacement({
			rows: 2,
			columns: 2,
			spotDiameter: 1,
			spotGap: 1,
			placement: { x: 0, y: 0, size: 2000 },
			heWidth: 1000,
			heHeight: 1000,
		});

		const baselineFirst = baseline.find((spot) => spot.id === "1:1");
		const grownFirst = grown.find((spot) => spot.id === "1:1");
		expect(baselineFirst).toBeDefined();
		expect(grownFirst).toBeDefined();
		// A larger placement square scales spot centers outward and widens spots.
		expect(grownFirst!.x).toBeGreaterThan(baselineFirst!.x);
		expect(grownFirst!.y).toBeGreaterThan(baselineFirst!.y);
		expect(grownFirst!.diameterX).toBeGreaterThan(baselineFirst!.diameterX);
	});

	it("returns no spots when placement dimensions are missing", () => {
		expect(
			projectSpotsForPlacement({
				rows: 2,
				columns: 2,
				spotDiameter: 1,
				spotGap: 1,
				placement: { x: 0, y: 0, size: 0 },
				heWidth: 1000,
				heHeight: 1000,
			}),
		).toEqual([]);
	});
});
