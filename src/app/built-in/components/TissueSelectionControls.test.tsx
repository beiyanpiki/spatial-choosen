import { ChakraProvider } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { theme } from "../../../theme";
import {
	type ThresholdMode,
	TissueSelectionControls,
	type TissueSelectionSupportState,
	type TissueTool,
} from "./TissueSelectionControls";

type RenderOptions = {
	thresholdMode?: ThresholdMode;
	activationThreshold?: number;
	blockThreshold?: number;
	supportState?: TissueSelectionSupportState;
	unsupportedReason?: string | null;
	isDetecting?: boolean;
	tissueTool?: TissueTool;
	showSpots?: boolean;
};

function renderControls({
	thresholdMode = "raw",
	activationThreshold = 0.1,
	blockThreshold = 135,
	supportState = "supported",
	unsupportedReason = null,
	isDetecting = false,
	tissueTool = "activate",
	showSpots = true,
}: RenderOptions = {}) {
	const onThresholdModeChange = vi.fn();
	const onActivationThresholdChange = vi.fn();
	const onBlockThresholdChange = vi.fn();
	const onTissueToolChange = vi.fn();
	const onRunAutoDetection = vi.fn();
	const onShowSpotsChange = vi.fn();

	function Harness() {
		const [currentThresholdMode, setCurrentThresholdMode] =
			useState(thresholdMode);
		const [currentActivationThreshold, setCurrentActivationThreshold] =
			useState(activationThreshold);
		const [currentBlockThreshold, setCurrentBlockThreshold] =
			useState(blockThreshold);
		const [currentTissueTool, setCurrentTissueTool] = useState(tissueTool);
		const [currentShowSpots, setCurrentShowSpots] = useState(showSpots);

		return (
			<TissueSelectionControls
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
	};
}

function renderEditingHarness({
	activationThreshold = 0.1,
	blockThreshold = 135,
}: Pick<RenderOptions, "activationThreshold" | "blockThreshold"> = {}) {
	const activationValues: number[] = [];
	const blockValues: number[] = [];

	function Harness() {
		const [currentActivationThreshold, setCurrentActivationThreshold] =
			useState(activationThreshold);
		const [activationInputValue, setActivationInputValue] =
			useState(String(activationThreshold));
		const [currentBlockThreshold, setCurrentBlockThreshold] =
			useState(blockThreshold);
		const [blockInputValue, setBlockInputValue] = useState(String(blockThreshold));

		useEffect(() => {
			setActivationInputValue(String(currentActivationThreshold));
		}, [currentActivationThreshold]);

		useEffect(() => {
			setBlockInputValue(String(currentBlockThreshold));
		}, [currentBlockThreshold]);

		return (
			<>
				<TissueSelectionControls
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
						onShowSpotsChange={vi.fn()}
				/>
				<input
					data-testid="activation-edit-proxy"
					value={activationInputValue}
					onChange={(event) => {
						setActivationInputValue(event.target.value);
					}}
				/>
				<input
					data-testid="block-edit-proxy"
					value={blockInputValue}
					onChange={(event) => {
						setBlockInputValue(event.target.value);
					}}
				/>
			</>
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

	it("renders only tissue and background marking tools for supported chips", async () => {
		const user = userEvent.setup();
		const {
			onThresholdModeChange,
			onActivationThresholdChange,
			onBlockThresholdChange,
			onTissueToolChange,
			onRunAutoDetection,
		} = renderControls();

		const thresholdModeSelect = screen.getByTestId(
			"tissue-threshold-mode-select",
		);
		expect(thresholdModeSelect).toHaveValue("raw");
		expect(screen.getByRole("option", { name: "raw" })).toBeInTheDocument();
		expect(
			screen.getByRole("option", { name: "gray-max" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("option", { name: "gray-min" }),
		).toBeInTheDocument();

		const activationThresholdInput = screen.getByTestId(
			"tissue-activation-threshold-input",
		);
		const blockThresholdInput = screen.getByTestId(
			"tissue-block-threshold-input",
		);
		expect(activationThresholdInput).toHaveValue(0.1);
		expect(blockThresholdInput).toHaveValue(135);

		const activateButton = screen.getByRole("button", { name: "Mark as tissue" });
		const deactivateButton = screen.getByRole("button", { name: "Mark as background" });
		expect(activateButton).toBeEnabled();
		expect(deactivateButton).toBeEnabled();
		expect(
			screen.queryByRole("button", { name: /draw/i }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /edit/i }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /erase/i }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /delete/i }),
		).not.toBeInTheDocument();
		expect(screen.queryByText(/selected region/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/region list/i)).not.toBeInTheDocument();

		await user.selectOptions(thresholdModeSelect, "gray-min");
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
		const { onRunAutoDetection } = renderControls();

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
		renderControls({
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
		expect(screen.getByTestId("tissue-threshold-mode-select")).toBeDisabled();
		expect(
			screen.getByTestId("tissue-activation-threshold-input"),
		).toBeDisabled();
		expect(screen.getByTestId("tissue-block-threshold-input")).toBeDisabled();
		expect(screen.getByTestId("tissue-run-auto")).toBeDisabled();
		expect(screen.getByTestId("tissue-tool-activate")).toBeDisabled();
		expect(screen.getByTestId("tissue-tool-deactivate")).toBeDisabled();
	});

	it("renders the revised tissue detection and refinement copy", () => {
		renderControls();

		expect(screen.getByText("Automatic Tissue Detection")).toBeInTheDocument();
		expect(screen.getByText("Tissue Signal Threshold")).toBeInTheDocument();
		expect(screen.getByText("Saturation Threshold")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Detect Tissue Spots" })).toBeInTheDocument();
		expect(screen.getByText("Manual Refinement")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Invert selection" })).toBeInTheDocument();
	});
});
