import { ChakraProvider } from "@chakra-ui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { theme } from "../../../theme";
import {
	type ThresholdMode,
	TissueControlPanel,
	type TissueSelectionSupportState,
	type TissueTool,
} from "./TissueControlPanel";
import type { TissueSpotStyle } from "@/types/preprocess";

type RenderOptions = {
	thresholdMode?: ThresholdMode;
	activationThreshold?: number;
	blockThreshold?: number;
	supportState?: TissueSelectionSupportState;
	unsupportedReason?: string | null;
	isDetecting?: boolean;
	tissueTool?: TissueTool;
	showSpots?: boolean;
	detectionWarning?: string | null;
	chipBlockedReason?: string | null;
};

function renderPanel({
	thresholdMode = "raw",
	activationThreshold = 0.1,
	blockThreshold = 35,
	supportState = "supported",
	unsupportedReason = null,
	isDetecting = false,
	tissueTool = "activate",
	showSpots = true,
	detectionWarning = null,
	chipBlockedReason = null,
}: RenderOptions = {}) {
	const onThresholdModeChange = vi.fn();
	const onActivationThresholdChange = vi.fn();
	const onBlockThresholdChange = vi.fn();
	const onTissueToolChange = vi.fn();
	const onRunAutoDetection = vi.fn();
	const onShowSpotsChange = vi.fn();
	const onChipTypeChange = vi.fn();
	const onSpotStyleChange = vi.fn();

	function Harness() {
		const [currentThresholdMode, setCurrentThresholdMode] =
			useState(thresholdMode);
		const [currentActivationThreshold, setCurrentActivationThreshold] =
			useState(activationThreshold);
		const [currentBlockThreshold, setCurrentBlockThreshold] =
			useState(blockThreshold);
		const [currentTissueTool, setCurrentTissueTool] = useState(tissueTool);
		const [currentShowSpots, setCurrentShowSpots] = useState(showSpots);
		const [currentSpotStyle, setCurrentSpotStyle] = useState<TissueSpotStyle>({
			color: "#38A169",
			opacity: 0.8,
		});

		return (
			<TissueControlPanel
				spotStyle={currentSpotStyle}
				onSpotStyleChange={(style) => {
					onSpotStyleChange(style);
					setCurrentSpotStyle(style);
				}}
				detectionWarning={detectionWarning}
				detectionStatus="Choose a signal mode and auto-select tissue spots to refresh the tissue matrix."
				chipType="15um"
				chipOptions={["15um", "50um"]}
				isChipSelectorDisabled={false}
				onChipTypeChange={(value) => {
					onChipTypeChange(value);
				}}
				chipBlockedReason={chipBlockedReason}
				chipError={null}
				thresholdMode={currentThresholdMode}
				activationThreshold={currentActivationThreshold}
				blockThreshold={currentBlockThreshold}
				supportState={supportState}
				unsupportedReason={unsupportedReason}
				isDetecting={isDetecting}
				tissueTool={currentTissueTool}
				showSpots={currentShowSpots}
				onThresholdModeChange={(value) => {
					onThresholdModeChange(value);
					setCurrentThresholdMode(value);
				}}
				onActivationThresholdChange={(value) => {
					onActivationThresholdChange(value);
					setCurrentActivationThreshold(value);
				}}
				onBlockThresholdChange={(value) => {
					onBlockThresholdChange(value);
					setCurrentBlockThreshold(value);
				}}
				onTissueToolChange={(value) => {
					onTissueToolChange(value);
					setCurrentTissueTool(value);
				}}
				onRunAutoDetection={onRunAutoDetection}
				onInvertSelection={vi.fn()}
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

	return {
		onThresholdModeChange,
		onActivationThresholdChange,
		onBlockThresholdChange,
		onTissueToolChange,
		onRunAutoDetection,
		onShowSpotsChange,
		onChipTypeChange,
		onSpotStyleChange,
	};
}

function renderEditingHarness({
	activationThreshold = 0.1,
	blockThreshold = 35,
}: Pick<RenderOptions, "activationThreshold" | "blockThreshold"> = {}) {
	const activationValues: number[] = [];
	const blockValues: number[] = [];

	function Harness() {
		const [currentActivationThreshold, setCurrentActivationThreshold] =
			useState(activationThreshold);
		const [currentBlockThreshold, setCurrentBlockThreshold] =
			useState(blockThreshold);

		return (
			<TissueControlPanel
				spotStyle={{ color: "#38A169", opacity: 0.8 }}
				onSpotStyleChange={vi.fn()}
				detectionWarning={null}
				detectionStatus="status"
				chipType="15um"
				chipOptions={["15um", "50um"]}
				isChipSelectorDisabled={false}
				onChipTypeChange={vi.fn()}
				chipBlockedReason={null}
				chipError={null}
				thresholdMode="raw"
				activationThreshold={currentActivationThreshold}
				blockThreshold={currentBlockThreshold}
				supportState="supported"
				unsupportedReason={null}
				isDetecting={false}
				tissueTool="activate"
				showSpots={true}
				onThresholdModeChange={vi.fn()}
				onActivationThresholdChange={(value) => {
					activationValues.push(value);
					setCurrentActivationThreshold(value);
				}}
				onBlockThresholdChange={(value) => {
					blockValues.push(value);
					setCurrentBlockThreshold(value);
				}}
				onTissueToolChange={vi.fn()}
				onRunAutoDetection={vi.fn()}
				onInvertSelection={vi.fn()}
				onShowSpotsChange={vi.fn()}
			/>
		);
	}

	render(
		<ChakraProvider theme={theme}>
			<Harness />
		</ChakraProvider>,
	);

	return { activationValues, blockValues };
}

function onLast(values: number[]) {
	return values[values.length - 1];
}

describe("TissueControlPanel", () => {
	it("toggles the spot grid switch and callback", async () => {
		const user = userEvent.setup();
		const { onShowSpotsChange } = renderPanel({ showSpots: true });

		const spotGridSwitch = screen.getByRole("switch");
		expect(spotGridSwitch).toBeChecked();

		await user.click(spotGridSwitch);
		expect(onShowSpotsChange).toHaveBeenCalledWith(false);
		expect(spotGridSwitch).not.toBeChecked();
	});

	it("renders the palette, chip, detection and refinement sections", async () => {
		const user = userEvent.setup();
		const {
			onSpotStyleChange,
			onThresholdModeChange,
			onActivationThresholdChange,
			onBlockThresholdChange,
			onTissueToolChange,
			onRunAutoDetection,
			onChipTypeChange,
		} = renderPanel();

		expect(screen.getByText("Spot style")).toBeInTheDocument();
		expect(screen.getByTestId("tissue-style-color")).toBeInTheDocument();
		expect(screen.getByText("80%")).toBeInTheDocument();
		expect(screen.getByLabelText("Spot opacity")).toBeInTheDocument();

		expect(screen.getByText("Chip")).toBeInTheDocument();
		expect(
			screen.getByTestId("tissue-chip-size-option-15um"),
		).toHaveAttribute("aria-pressed", "true");
		expect(
			screen.getByTestId("tissue-chip-size-option-50um"),
		).toHaveAttribute("aria-pressed", "false");

		const modeOption = (mode: ThresholdMode) =>
			screen.getByTestId(`tissue-threshold-mode-option-${mode}`);
		expect(modeOption("raw")).toHaveAttribute("aria-pressed", "true");
		expect(modeOption("gray-max")).toHaveAttribute("aria-pressed", "false");
		expect(modeOption("gray-min")).toHaveAttribute("aria-pressed", "false");

		const activationThresholdInput = screen.getByTestId(
			"tissue-activation-threshold-input",
		);
		const blockThresholdInput = screen.getByTestId(
			"tissue-block-threshold-input",
		);
		expect(activationThresholdInput).toHaveValue(0.1);
		expect(blockThresholdInput).toHaveValue(35);

		const activateButton = screen.getByRole("button", { name: "Tissue" });
		const deactivateButton = screen.getByRole("button", { name: "Background" });
		expect(activateButton).toBeEnabled();
		expect(deactivateButton).toBeEnabled();

		await user.click(screen.getByTestId("tissue-chip-size-option-50um"));
		expect(onChipTypeChange).toHaveBeenCalledWith("50um");

		await user.click(modeOption("gray-min"));
		expect(onThresholdModeChange).toHaveBeenCalledWith("gray-min");

		await user.clear(activationThresholdInput);
		await user.type(activationThresholdInput, "0.25");
		expect(onActivationThresholdChange).toHaveBeenLastCalledWith(0.25);

		await user.clear(blockThresholdInput);
		await user.type(blockThresholdInput, "120");
		expect(onBlockThresholdChange).toHaveBeenLastCalledWith(120);

		await user.click(screen.getByTestId("tissue-tool-activate"));
		expect(onTissueToolChange).toHaveBeenCalledWith("activate");

		await user.click(screen.getByTestId("tissue-tool-deactivate"));
		expect(onTissueToolChange).toHaveBeenCalledWith("deactivate");

		await user.click(screen.getByTestId("tissue-run-auto"));
		expect(onRunAutoDetection).toHaveBeenCalledTimes(1);
	});

	it("opens the in-page palette and applies colors and opacity", async () => {
		const user = userEvent.setup();
		const { onSpotStyleChange } = renderPanel();

		// The palette popover is closed until the color button is clicked.
		expect(
			screen.queryByTestId("tissue-style-palette"),
		).not.toBeInTheDocument();
		await user.click(screen.getByTestId("tissue-style-color"));
		expect(screen.getByTestId("tissue-style-palette")).toBeInTheDocument();

		// Choosing a swatch applies it and closes the palette.
		await user.click(screen.getByTestId("tissue-style-swatch-e53e3e"));
		expect(onSpotStyleChange).toHaveBeenLastCalledWith({
			color: "#E53E3E",
			opacity: 0.8,
		});
		expect(screen.queryByTestId("tissue-style-palette")).not.toBeInTheDocument();

		// Reopen and apply an arbitrary color via the hex input.
		await user.click(screen.getByTestId("tissue-style-color"));
		await user.type(screen.getByTestId("tissue-style-hex-input"), "#ff0000");
		expect(onSpotStyleChange).toHaveBeenLastCalledWith({
			color: "#FF0000",
			opacity: 0.8,
		});

		fireEvent.change(screen.getByTestId("tissue-style-opacity-slider"), {
			target: { value: "40" },
		});
		expect(onSpotStyleChange).toHaveBeenLastCalledWith({
			color: "#FF0000",
			opacity: 0.4,
		});
	});

	it("does not emit invalid numeric values while editing threshold inputs", async () => {
		const user = userEvent.setup();
		const { activationValues, blockValues } = renderEditingHarness();

		const activationThresholdInput = screen.getByTestId(
			"tissue-activation-threshold-input",
		);
		const blockThresholdInput = screen.getByTestId(
			"tissue-block-threshold-input",
		);

		await user.clear(activationThresholdInput);
		expect(activationValues).toEqual([]);

		await user.type(activationThresholdInput, "0.");
		expect(activationValues).toEqual([0]);
		expect(activationValues.some(Number.isNaN)).toBe(false);

		await user.type(activationThresholdInput, "25");
		expect(onLast(activationValues)).toBe(0.25);
		expect(activationValues.some(Number.isNaN)).toBe(false);

		await user.clear(blockThresholdInput);
		expect(blockValues).toEqual([]);

		await user.type(blockThresholdInput, "120");
		expect(blockValues).toEqual([1, 12, 120]);
		expect(blockValues.some(Number.isNaN)).toBe(false);
	});

	it("does not emit out-of-range threshold values upstream", async () => {
		const user = userEvent.setup();
		const { activationValues, blockValues } = renderEditingHarness();

		const activationThresholdInput = screen.getByTestId(
			"tissue-activation-threshold-input",
		);
		const blockThresholdInput = screen.getByTestId(
			"tissue-block-threshold-input",
		);

		await user.clear(activationThresholdInput);
		await user.type(activationThresholdInput, "1.5");
		expect(activationValues).toEqual([1]);
		expect(onLast(activationValues)).toBe(1);
		expect(activationValues).not.toContain(1.5);

		await user.clear(blockThresholdInput);
		await user.type(blockThresholdInput, "300");
		expect(blockValues).toEqual([3, 30]);
		expect(onLast(blockValues)).toBe(30);
		expect(blockValues).not.toContain(300);
	});

	it("normalizes out-of-range edits back to the last valid visible value", async () => {
		const user = userEvent.setup();
		const { activationValues, blockValues } = renderEditingHarness();

		const activationThresholdInput = screen.getByTestId(
			"tissue-activation-threshold-input",
		) as HTMLInputElement;
		const blockThresholdInput = screen.getByTestId(
			"tissue-block-threshold-input",
		) as HTMLInputElement;

		await user.clear(activationThresholdInput);
		await user.type(activationThresholdInput, "1.5");
		expect(activationValues).toEqual([1]);
		expect(onLast(activationValues)).toBe(1);
		expect(activationValues).not.toContain(1.5);
		expect(activationThresholdInput.value).toBe("1");

		await user.clear(blockThresholdInput);
		await user.type(blockThresholdInput, "300");
		expect(blockValues).toEqual([3, 30]);
		expect(onLast(blockValues)).toBe(30);
		expect(blockValues).not.toContain(300);
		expect(blockThresholdInput.value).toBe("30");
	});

	it("disables tissue auto-selection while a threshold input is in an invalid partial local state", async () => {
		const user = userEvent.setup();
		const { onRunAutoDetection } = renderPanel();

		const activationThresholdInput = screen.getByTestId(
			"tissue-activation-threshold-input",
		) as HTMLInputElement;
		const runAutoButton = screen.getByTestId("tissue-run-auto");

		expect(runAutoButton).toBeEnabled();

		await user.clear(activationThresholdInput);
		expect(activationThresholdInput.value).toBe("");
		expect(runAutoButton).toBeDisabled();

		await user.type(activationThresholdInput, "0.25");
		expect(activationThresholdInput.value).toBe("0.25");
		expect(runAutoButton).toBeEnabled();

		await user.click(runAutoButton);
		expect(onRunAutoDetection).toHaveBeenCalledTimes(1);
	});

	it("renders the exact unsupported message and disables all tissue-selection actions", () => {
		renderPanel({
			supportState: "unsupported",
			unsupportedReason: "Chip size 25um is not supported.",
		});

		expect(
			screen.getByText(
				"Tissue auto-selection currently supports only 15um and 50um capture chips.",
			),
		).toBeInTheDocument();
		expect(
			screen.getByText("Chip size 25um is not supported."),
		).toBeInTheDocument();
		expect(screen.getByTestId("tissue-threshold-mode-option-raw")).toBeDisabled();
		expect(
			screen.getByTestId("tissue-activation-threshold-input"),
		).toBeDisabled();
		expect(screen.getByTestId("tissue-block-threshold-input")).toBeDisabled();
		expect(screen.getByTestId("tissue-run-auto")).toBeDisabled();
		expect(screen.getByTestId("tissue-tool-activate")).toBeDisabled();
		expect(screen.getByTestId("tissue-tool-deactivate")).toBeDisabled();
	});

	it("renders the detection and refinement copy", () => {
		renderPanel();

		expect(screen.getByText("Automatic detection")).toBeInTheDocument();
		expect(screen.getByText("Tissue Signal Threshold")).toBeInTheDocument();
		expect(screen.getByText("Saturation Threshold")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Detect Tissue Spots" })).toBeInTheDocument();
		expect(screen.getByText("Manual refinement")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Invert selection" })).toBeInTheDocument();
		expect(screen.getByText("Mark spots as")).toBeInTheDocument();
	});

	it("shows the detection warning instead of the status message", () => {
		renderPanel({ detectionWarning: "Low contrast image." });

		expect(screen.getByTestId("tissue-detection-warning")).toHaveTextContent(
			"Low contrast image.",
		);
		expect(screen.queryByTestId("tissue-detection-status")).not.toBeInTheDocument();
	});

	it("shows the chip blocked reason while the registered crop is missing", () => {
		renderPanel({ chipBlockedReason: "Registered ROI size is unavailable." });

		expect(
			screen.getByText("Registered ROI size is unavailable."),
		).toBeInTheDocument();
	});
});
