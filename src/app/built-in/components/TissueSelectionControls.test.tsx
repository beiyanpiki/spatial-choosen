import { ChakraProvider } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { theme } from "../../../theme";
import {
	type TissueSelectionSupportState,
	TissueSelectionControls,
	type TissueTool,
} from "./TissueSelectionControls";

type RenderOptions = {
	supportState?: TissueSelectionSupportState;
	unsupportedReason?: string | null;
	disabled?: boolean;
	tissueTool?: TissueTool;
	showSpots?: boolean;
};

function renderControls({
	supportState = "supported",
	unsupportedReason = null,
	disabled = false,
	tissueTool = "activate",
	showSpots = true,
}: RenderOptions = {}) {
	const onTissueToolChange = vi.fn();
	const onInvertSelection = vi.fn();
	const onShowSpotsChange = vi.fn();

	function Harness() {
		const [currentTissueTool, setCurrentTissueTool] = useState(tissueTool);
		const [currentShowSpots, setCurrentShowSpots] = useState(showSpots);

		return (
			<TissueSelectionControls
				supportState={supportState}
				unsupportedReason={unsupportedReason}
				disabled={disabled}
				tissueTool={currentTissueTool}
				showSpots={currentShowSpots}
				onTissueToolChange={(value) => {
					onTissueToolChange(value);
					setCurrentTissueTool(value);
				}}
				onInvertSelection={onInvertSelection}
				onShowSpotsChange={(value) => {
					onShowSpotsChange(value);
					setCurrentShowSpots(value);
				}}
			/>
		);
	}

	render(
		<ChakraProvider theme={theme}>
			<Harness />
		</ChakraProvider>,
	);

	return { onTissueToolChange, onInvertSelection, onShowSpotsChange };
}

describe("TissueSelectionControls", () => {
	it("toggles the show spots button label and callback", async () => {
		const user = userEvent.setup();
		const { onShowSpotsChange } = renderControls({ showSpots: true });

		const toggleButton = screen.getByRole("button", { name: "Hide spot grid" });
		expect(toggleButton).toBeEnabled();

		await user.click(toggleButton);
		expect(onShowSpotsChange).toHaveBeenCalledWith(false);
		expect(screen.getByRole("button", { name: "Show spot grid" })).toBeInTheDocument();
	});

	it("exposes only the tissue and background marking tools and the invert action", async () => {
		const user = userEvent.setup();
		const { onTissueToolChange, onInvertSelection } = renderControls();

		const activateButton = screen.getByRole("button", { name: "Mark as tissue" });
		const deactivateButton = screen.getByRole("button", { name: "Mark as background" });
		expect(activateButton).toBeEnabled();
		expect(deactivateButton).toBeEnabled();
		expect(
			screen.getByRole("button", { name: "Invert selection" }),
		).toBeInTheDocument();
		// Auto-detection UI was removed in the HE-only model.
		expect(
			screen.queryByRole("button", { name: /detect tissue/i }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByTestId("tissue-threshold-mode-select"),
		).not.toBeInTheDocument();

		await user.click(screen.getByTestId("tissue-tool-activate"));
		expect(onTissueToolChange).toHaveBeenCalledWith("activate");

		await user.click(screen.getByTestId("tissue-tool-deactivate"));
		expect(onTissueToolChange).toHaveBeenCalledWith("deactivate");

		await user.click(screen.getByTestId("tissue-invert-selection"));
		expect(onInvertSelection).toHaveBeenCalledTimes(1);
	});

	it("renders the unsupported notice and disables manual refinement actions", () => {
		renderControls({
			supportState: "unsupported",
			unsupportedReason: "50um tissue auto-selection requires a 64x64 spot grid.",
		});

		expect(
			screen.getByText(
				"Tissue spot selection currently supports only 15um and 50um capture chips.",
			),
		).toBeInTheDocument();
		expect(
			screen.getByText("50um tissue auto-selection requires a 64x64 spot grid."),
		).toBeInTheDocument();
		expect(screen.getByTestId("tissue-tool-activate")).toBeDisabled();
		expect(screen.getByTestId("tissue-tool-deactivate")).toBeDisabled();
		expect(screen.getByTestId("tissue-invert-selection")).toBeDisabled();
		expect(screen.getByTestId("tissue-show-spots-toggle")).toBeDisabled();
	});
});
