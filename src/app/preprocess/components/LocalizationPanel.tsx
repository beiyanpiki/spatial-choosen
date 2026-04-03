"use client";

import {
	Badge,
	Box,
	Button,
	ButtonGroup,
	Divider,
	Flex,
	Heading,
	Input,
	Stack,
	Text,
} from "@chakra-ui/react";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { LOCALIZATION_BOX_COLOR_SWATCHS } from "@/lib/preprocess/localization";
import type {
	LocalizationBoxColor,
	LocalizationImageTransform,
	PreprocessSourceImage,
} from "@/types/preprocess";

type LocalizationPanelProps = {
	boxColor: LocalizationBoxColor;
	image: PreprocessSourceImage | null;
	imageTransform: LocalizationImageTransform;
	onBoxColorChange: (value: LocalizationBoxColor) => void;
	onFlipHorizontal: () => void;
	onFlipVertical: () => void;
	onResetTransform: () => void;
	onRotationChange: (value: number) => void;
	onRotationDelta: (delta: number) => void;
	onScaleChange: (value: number) => void;
	onScaleDelta: (delta: number) => void;
};

export function LocalizationPanel({
	boxColor,
	image,
	imageTransform,
	onBoxColorChange,
	onFlipHorizontal,
	onFlipVertical,
	onResetTransform,
	onRotationChange,
	onRotationDelta,
	onScaleChange,
	onScaleDelta,
}: LocalizationPanelProps) {
	const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const suppressClickRef = useRef(false);
	const [rotationDraft, setRotationDraft] = useState<string | null>(null);
	const [scaleDraft, setScaleDraft] = useState<string | null>(null);
	const rotationInputValue =
		rotationDraft ?? imageTransform.rotationDegrees.toFixed(1);
	const scaleInputValue = scaleDraft ?? (imageTransform.scale * 100).toFixed(0);

	const stopHoldAction = useCallback(() => {
		if (holdTimeoutRef.current) {
			clearTimeout(holdTimeoutRef.current);
			holdTimeoutRef.current = null;
		}
		if (holdIntervalRef.current) {
			clearInterval(holdIntervalRef.current);
			holdIntervalRef.current = null;
		}
	}, []);

	useEffect(
		() => () => {
			stopHoldAction();
		},
		[stopHoldAction],
	);

	const commitRotationDraft = () => {
		if (rotationDraft == null) {
			return;
		}

		const next = Number(rotationDraft);
		if (!Number.isFinite(next)) {
			setRotationDraft(null);
			return;
		}

		onRotationChange(next);
		setRotationDraft(null);
	};

	const commitScaleDraft = () => {
		if (scaleDraft == null) {
			return;
		}

		const percent = Number(scaleDraft);
		if (!Number.isFinite(percent)) {
			setScaleDraft(null);
			return;
		}

		onScaleChange(percent / 100);
		setScaleDraft(null);
	};

	const createFineAdjustHandlers = (applyDelta: () => void) => ({
		onClick: () => {
			if (suppressClickRef.current) {
				suppressClickRef.current = false;
				return;
			}
			applyDelta();
		},
		onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
			if (event.button !== 0) {
				return;
			}

			suppressClickRef.current = true;
			stopHoldAction();
			event.currentTarget.setPointerCapture(event.pointerId);
			applyDelta();
			holdTimeoutRef.current = setTimeout(() => {
				holdIntervalRef.current = setInterval(() => {
					applyDelta();
				}, 75);
			}, 300);
		},
		onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => {
			stopHoldAction();
			if (event.currentTarget.hasPointerCapture(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
		},
		onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => {
			stopHoldAction();
			if (event.currentTarget.hasPointerCapture(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
		},
	});

	const rotateFineMinusHandlers = createFineAdjustHandlers(() =>
		onRotationDelta(-0.1),
	);
	const rotateFinePlusHandlers = createFineAdjustHandlers(() =>
		onRotationDelta(0.1),
	);
	const scaleFineMinusHandlers = createFineAdjustHandlers(() =>
		onScaleDelta(-0.01),
	);
	const scaleFinePlusHandlers = createFineAdjustHandlers(() =>
		onScaleDelta(0.01),
	);

	return (
		<Stack
			spacing={4}
			w={{ base: "100%", xl: "320px" }}
			minW={{ base: "100%", xl: "320px" }}
			alignSelf="stretch"
			data-testid="preprocess-localization-properties-rail"
		>
			<Box
				bg="white"
				border="1px solid"
				borderColor="gray.200"
				borderRadius="2xl"
				boxShadow="sm"
				px={4}
				py={4}
			>
				<Stack spacing={4}>
					<Stack spacing={1}>
						<Heading size="sm">Properties</Heading>
						<Text fontSize="sm" color="gray.500">
							Compact controls for image state, chip box styling, and precise
							transform edits.
						</Text>
					</Stack>

					<Box
						border="1px solid"
						borderColor="gray.200"
						borderRadius="xl"
						px={3}
						py={3}
					>
						<Stack spacing={3}>
							<Flex justify="space-between" align="flex-start" gap={3}>
								<Stack spacing={1}>
									<Heading size="sm">Image details</Heading>
									<Text fontSize="sm" color="gray.500">
										Localization uses the saved eosin intake asset from Source Assets.
									</Text>
								</Stack>
								<Badge
									colorScheme={image ? "green" : "orange"}
									alignSelf="flex-start"
									borderRadius="full"
								>
									{image ? "Ready" : "Missing"}
								</Badge>
							</Flex>
							<Text fontSize="sm" color="gray.600">
								{image
									? `${image.fileName} • ${image.width ?? "?"}×${image.height ?? "?"} px`
									: "Upload an eosin image in Source Assets to start localization."}
							</Text>
						</Stack>
					</Box>

					<Box
						border="1px solid"
						borderColor="gray.200"
						borderRadius="xl"
						px={3}
						py={3}
					>
						<Stack spacing={3}>
							<Stack spacing={1}>
								<Heading size="sm">Chip box</Heading>
								<Text fontSize="sm" color="gray.500">
									Choose the overlay tone without changing saved geometry.
								</Text>
							</Stack>
							<ButtonGroup size="sm" isAttached>
								{(["green", "white"] as const).map((value) => (
									<Button
										key={value}
										variant={boxColor === value ? "solid" : "outline"}
										colorScheme={boxColor === value ? "brand" : "gray"}
										onClick={() => onBoxColorChange(value)}
									>
										{LOCALIZATION_BOX_COLOR_SWATCHS[value].label}
									</Button>
								))}
							</ButtonGroup>
						</Stack>
					</Box>

					<Box
						border="1px solid"
						borderColor="gray.200"
						borderRadius="xl"
						px={3}
						py={3}
					>
						<Stack spacing={3}>
							<Stack spacing={1}>
								<Heading size="sm">Canvas controls</Heading>
								<Text fontSize="sm" color="gray.500">
									Wheel to zoom, drag the box edges to resize, drag the outer
									handle to rotate.
								</Text>
							</Stack>
							<Divider />
							<Text fontSize="sm" color="gray.600">
								Use the floating stage widget for quick zoom and quarter-turn
								rotation. Use the controls below when you need exact values.
							</Text>
						</Stack>
					</Box>

					<Box
						border="1px solid"
						borderColor="gray.200"
						borderRadius="xl"
						px={3}
						py={3}
					>
						<Stack spacing={4}>
							<Stack spacing={1}>
								<Heading size="sm">Precise transform</Heading>
								<Text fontSize="sm" color="gray.500">
									Display-only edits; chip coordinates remain normalized in
									image space.
								</Text>
							</Stack>

							<Stack spacing={3}>
								<Flex justify="space-between" align="center" gap={3}>
									<Heading
										size="xs"
										textTransform="uppercase"
										letterSpacing="0.08em"
										color="gray.500"
									>
										Rotation
									</Heading>
									<Text fontSize="sm" color="gray.600">
										{imageTransform.rotationDegrees.toFixed(1)}°
									</Text>
								</Flex>
								<Flex gap={2} align="center">
									<Input
										type="number"
										inputMode="decimal"
										min={-180}
										max={180}
										step={0.1}
										value={rotationInputValue}
										onChange={(event) => setRotationDraft(event.target.value)}
										onBlur={commitRotationDraft}
										onKeyDown={(event) => {
											if (event.key === "Enter") {
												event.currentTarget.blur();
											}
										}}
										data-testid="localize-rotation-input"
										size="sm"
										w="84px"
									/>
									<Text fontSize="sm" color="gray.500">
										degrees
									</Text>
								</Flex>
								<Flex wrap="wrap" gap={2}>
									<ButtonGroup size="sm" isAttached variant="outline">
										<Button
											onClick={() => onRotationDelta(-90)}
											data-testid="localize-rotate-minus-90"
										>
											-90°
										</Button>
										<Button
											onClick={() => onRotationDelta(90)}
											data-testid="localize-rotate-plus-90"
										>
											+90°
										</Button>
									</ButtonGroup>
									<ButtonGroup size="sm" isAttached variant="outline">
										<Button
											{...rotateFineMinusHandlers}
											data-testid="localize-rotate-fine-minus"
											aria-label="Decrease rotation"
										>
											-0.1°
										</Button>
										<Button
											{...rotateFinePlusHandlers}
											data-testid="localize-rotate-fine-plus"
											aria-label="Increase rotation"
										>
											+0.1°
										</Button>
									</ButtonGroup>
								</Flex>
							</Stack>

							<Stack spacing={3}>
								<Flex justify="space-between" align="center" gap={3}>
									<Heading
										size="xs"
										textTransform="uppercase"
										letterSpacing="0.08em"
										color="gray.500"
									>
										Scale
									</Heading>
									<Text fontSize="sm" color="gray.600">
										{(imageTransform.scale * 100).toFixed(0)}%
									</Text>
								</Flex>
								<Flex gap={2} align="center">
									<Input
										type="number"
										inputMode="decimal"
										min={50}
										max={400}
										step={1}
										value={scaleInputValue}
										onChange={(event) => setScaleDraft(event.target.value)}
										onBlur={commitScaleDraft}
										onKeyDown={(event) => {
											if (event.key === "Enter") {
												event.currentTarget.blur();
											}
										}}
										data-testid="localize-scale-input"
										size="sm"
										w="84px"
									/>
									<Text fontSize="sm" color="gray.500">
										percent
									</Text>
								</Flex>
								<ButtonGroup
									size="sm"
									isAttached
									variant="outline"
									w="fit-content"
								>
									<Button
										{...scaleFineMinusHandlers}
										data-testid="localize-scale-fine-minus"
										aria-label="Decrease zoom"
									>
										-1%
									</Button>
									<Button
										{...scaleFinePlusHandlers}
										data-testid="localize-scale-fine-plus"
										aria-label="Increase zoom"
									>
										+1%
									</Button>
								</ButtonGroup>
							</Stack>

							<Flex direction="column" gap={2}>
								<Button
									onClick={onFlipHorizontal}
									data-testid="localize-flip-horizontal"
									variant="outline"
									size="sm"
								>
									Flip horizontal
								</Button>
								<Button
									onClick={onFlipVertical}
									data-testid="localize-flip-vertical"
									variant="outline"
									size="sm"
								>
									Flip vertical
								</Button>
								<Button
									size="sm"
									colorScheme="brand"
									variant="ghost"
									onClick={onResetTransform}
									data-testid="localize-reset-transform"
								>
									Reset transform
								</Button>
							</Flex>
						</Stack>
					</Box>
				</Stack>
			</Box>
		</Stack>
	);
}
