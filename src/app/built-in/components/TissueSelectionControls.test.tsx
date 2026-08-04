import { ChakraProvider } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ChipPlacement } from "@/types/built-in";
import { theme } from "../../../theme";
import { TissueSelectionControls } from "./TissueSelectionControls";

type RenderOptions = {
	disabled?: boolean;
	showSpots?: boolean;
	placement?: ChipPlacement | null;
};

function renderControls({
	disabled = false,
	showSpots = true,
	placement = null,
}: RenderOptions = {}) {
	const onShowSpotsChange = vi.fn();
	const onResetPlacement = vi.fn();

	function Harness() {
		const [currentShowSpots, setCurrentShowSpots] = useState(showSpots);

		return (
			<TissueSelectionControls
				disabled={disabled}
				showSpots={currentShowSpots}
				onShowSpotsChange={(value) => {
					onShowSpotsChange(value);
					setCurrentShowSpots(value);
				}}
				onResetPlacement={onResetPlacement}
				placement={placement}
			/>
		);
	}

	render(
		<ChakraProvider theme={theme}>
			<Harness />
		</ChakraProvider>,
	);

	return { onShowSpotsChange, onResetPlacement };
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
			placement: { x: 10, y: 10, size: 100 },
		});

		const resetButton = screen.getByTestId("tissue-reset-placement");
		expect(resetButton).toBeEnabled();

		await user.click(resetButton);

		expect(onResetPlacement).toHaveBeenCalledTimes(1);
	});

	it("renders the rounded placement size and position in the readout", () => {
		renderControls({
			placement: { x: 123.4, y: 98.6, size: 456.7 },
		});

		expect(screen.getByTestId("tissue-placement-readout")).toHaveTextContent(
			"Covered region: 457×457 px at (123, 99)",
		);
	});

	it("renders the empty prompt when placement is null", () => {
		renderControls({ placement: null });

		expect(screen.getByTestId("tissue-placement-readout")).toHaveTextContent(
			"Position the chip grid over the tissue.",
		);
	});

	it("disables both actions when disabled", () => {
		renderControls({
			disabled: true,
			placement: { x: 10, y: 10, size: 100 },
		});

		expect(screen.getByTestId("tissue-show-spots-toggle")).toBeDisabled();
		expect(screen.getByTestId("tissue-reset-placement")).toBeDisabled();
	});
});
