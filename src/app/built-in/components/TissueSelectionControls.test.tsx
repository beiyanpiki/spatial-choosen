import { ChakraProvider } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { theme } from "../../../theme";
import { TissueSelectionControls } from "./TissueSelectionControls";

type RenderOptions = {
	disabled?: boolean;
	showSpots?: boolean;
	blockRect?: { width: number; height: number } | null;
	rows?: number;
	columns?: number;
	excludedRows?: number[];
	excludedColumns?: number[];
};

function renderControls({
	disabled = false,
	showSpots = true,
	blockRect = null,
	rows = 0,
	columns = 0,
	excludedRows = [],
	excludedColumns = [],
}: RenderOptions = {}) {
	const onShowSpotsChange = vi.fn();
	const onResetPlacement = vi.fn();
	const onExcludeRowsChange = vi.fn();
	const onExcludeColumnsChange = vi.fn();

	function Harness() {
		const [currentShowSpots, setCurrentShowSpots] = useState(showSpots);
		const [currentExcludedRows, setCurrentExcludedRows] = useState(excludedRows);
		const [currentExcludedColumns, setCurrentExcludedColumns] = useState(excludedColumns);

		return (
			<TissueSelectionControls
				disabled={disabled}
				showSpots={currentShowSpots}
				onShowSpotsChange={(value) => {
					onShowSpotsChange(value);
					setCurrentShowSpots(value);
				}}
				onResetPlacement={onResetPlacement}
				blockRect={blockRect}
				rows={rows}
				columns={columns}
				excludedRows={currentExcludedRows}
				excludedColumns={currentExcludedColumns}
				onExcludeRowsChange={(next) => {
					onExcludeRowsChange(next);
					setCurrentExcludedRows(next);
				}}
				onExcludeColumnsChange={(next) => {
					onExcludeColumnsChange(next);
					setCurrentExcludedColumns(next);
				}}
			/>
		);
	}

	render(
		<ChakraProvider theme={theme}>
			<Harness />
		</ChakraProvider>,
	);

	return { onShowSpotsChange, onResetPlacement, onExcludeRowsChange, onExcludeColumnsChange };
}

describe("TissueSelectionControls", () => {
	it("toggles the show/hide spot grid button label and callback", async () => {
		const user = userEvent.setup();
		const { onShowSpotsChange } = renderControls({ showSpots: true });

		const toggleButton = screen.getByTestId("tissue-show-spots-toggle");
		expect(toggleButton).toHaveTextContent("Hide spot grid");
		expect(toggleButton).toBeEnabled();

		await user.click(toggleButton);

		expect(onShowSpotsChange).toHaveBeenCalledWith(false);
		expect(toggleButton).toHaveTextContent("Show spot grid");
	});

	it("calls onResetPlacement when the reset button is clicked", async () => {
		const user = userEvent.setup();
		const { onResetPlacement } = renderControls({
			blockRect: { width: 500, height: 400 },
		});

		const resetButton = screen.getByTestId("tissue-reset-placement");
		expect(resetButton).toBeEnabled();

		await user.click(resetButton);

		expect(onResetPlacement).toHaveBeenCalledTimes(1);
	});

	it("renders the rounded block size in the readout", () => {
		renderControls({ blockRect: { width: 123.4, height: 98.6 } });

		expect(screen.getByTestId("tissue-placement-readout")).toHaveTextContent(
			"Covered region: 123×99 px",
		);
	});

	it("renders the empty prompt when blockRect is null", () => {
		renderControls({ blockRect: null });

		expect(screen.getByTestId("tissue-placement-readout")).toHaveTextContent(
			"Position the chip grid over the tissue.",
		);
	});

	it("disables both actions when disabled", () => {
		renderControls({ disabled: true, blockRect: { width: 500, height: 500 } });

		expect(screen.getByTestId("tissue-show-spots-toggle")).toBeDisabled();
		expect(screen.getByTestId("tissue-reset-placement")).toBeDisabled();
	});

	it("toggles row exclusion via checkboxes and reports the sorted list", async () => {
		const user = userEvent.setup();
		const { onExcludeRowsChange } = renderControls({ rows: 3 });

		const row2 = screen.getByRole("checkbox", { name: "2" });
		await user.click(row2);

		expect(onExcludeRowsChange).toHaveBeenCalledWith([2]);
	});

	it("shows existing exclusions as checked and toggling removes them", async () => {
		const user = userEvent.setup();
		const { onExcludeRowsChange } = renderControls({
			rows: 3,
			excludedRows: [1, 3],
		});

		expect(screen.getByRole("checkbox", { name: "1" })).toBeChecked();
		expect(screen.getByRole("checkbox", { name: "3" })).toBeChecked();

		await user.click(screen.getByRole("checkbox", { name: "1" }));
		expect(onExcludeRowsChange).toHaveBeenCalledWith([3]);
	});

	it("handles column exclusion independently", async () => {
		const user = userEvent.setup();
		const { onExcludeColumnsChange, onExcludeRowsChange } = renderControls({ columns: 2 });

		await user.click(screen.getByRole("checkbox", { name: "1" }));

		expect(onExcludeColumnsChange).toHaveBeenCalledWith([1]);
		expect(onExcludeRowsChange).not.toHaveBeenCalled();
	});
});
