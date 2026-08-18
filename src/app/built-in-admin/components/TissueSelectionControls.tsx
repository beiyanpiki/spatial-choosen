import {
  Button,
  Card,
  CardBody,
  FormControl,
  FormLabel,
  Input,
  Select,
  Stack,
  Text,
} from '@chakra-ui/react';
import { useEffect, useState } from 'react';

export type ThresholdMode = 'raw' | 'gray-max' | 'gray-min';
export type TissueSelectionSupportState = 'supported' | 'unsupported';
export type TissueTool = 'activate' | 'deactivate';

type TissueSelectionControlsProps = {
	thresholdMode: ThresholdMode;
	activationThreshold: number;
	blockThreshold: number;
	supportState: TissueSelectionSupportState;
	unsupportedReason: string | null;
	isDetecting: boolean;
	hasSelectionMatrix: boolean;
	tissueTool: TissueTool;
	showSpots: boolean;
	onThresholdModeChange: (mode: ThresholdMode) => void;
	onActivationThresholdChange: (value: number) => void;
	onBlockThresholdChange: (value: number) => void;
	onTissueToolChange: (tool: TissueTool) => void;
	onRunAutoDetection: () => void;
	onInvertSelection: () => void;
	onShowSpotsChange: (showSpots: boolean) => void;
};

const THRESHOLD_MODE_OPTIONS: ThresholdMode[] = ['raw', 'gray-max', 'gray-min'];
const TOOL_OPTIONS: Array<{ label: string; value: TissueTool }> = [
  { label: 'Mark as tissue', value: 'activate' },
  { label: 'Mark as background', value: 'deactivate' },
];

function parseActivationThresholdInput(value: string) {
  if (!/^\d*\.?\d+$/.test(value)) {
    return null;
  }

  const parsedValue = Number(value);
  if (parsedValue < 0 || parsedValue > 1) {
    return null;
  }

  return parsedValue;
}

function parseBlockThresholdInput(value: string) {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsedValue = Number(value);
  if (parsedValue < 0 || parsedValue > 255) {
    return null;
  }

  return parsedValue;
}

function hasInvalidActivationThresholdState(value: string) {
  return value !== '' && parseActivationThresholdInput(value) === null;
}

function hasInvalidBlockThresholdState(value: string) {
  return value !== '' && parseBlockThresholdInput(value) === null;
}

export function TissueSelectionControls({
	thresholdMode,
	activationThreshold,
	blockThreshold,
	supportState,
	unsupportedReason,
	isDetecting,
	hasSelectionMatrix,
	tissueTool,
	showSpots,
	onThresholdModeChange,
	onActivationThresholdChange,
	onBlockThresholdChange,
	onTissueToolChange,
	onRunAutoDetection,
	onInvertSelection,
	onShowSpotsChange,
}: TissueSelectionControlsProps) {
  const isUnsupported = supportState === 'unsupported';
  const [activationThresholdInput, setActivationThresholdInput] = useState(() => String(activationThreshold));
  const [blockThresholdInput, setBlockThresholdInput] = useState(() => String(blockThreshold));
  const hasInvalidLocalThresholdState =
    activationThresholdInput === '' ||
    blockThresholdInput === '' ||
    hasInvalidActivationThresholdState(activationThresholdInput) ||
    hasInvalidBlockThresholdState(blockThresholdInput);

  useEffect(() => {
    setActivationThresholdInput(String(activationThreshold));
  }, [activationThreshold]);

  useEffect(() => {
    setBlockThresholdInput(String(blockThreshold));
  }, [blockThreshold]);

  const blockThresholdLabel = thresholdMode === 'raw' ? 'Saturation Threshold' : 'Background cutoff';

  return (
    <Stack spacing={4}>
      <Card border="1px solid" borderColor="gray.200" borderRadius="2xl" boxShadow="sm" bg="white">
        <CardBody p={4}>
          <Stack spacing={4}>
            <Text fontSize="sm" fontWeight="semibold">Automatic Tissue Detection</Text>
            {isUnsupported ? (
              <Stack spacing={1}>
                <Text fontSize="sm" color="orange.700">
                  Tissue auto-selection currently supports only 15um and 50um capture chips.
                </Text>
                {unsupportedReason ? (
                  <Text fontSize="sm" color="gray.600">
                    {unsupportedReason}
                  </Text>
                ) : null}
              </Stack>
            ) : null}
            <FormControl isDisabled={isUnsupported || isDetecting}>
              <FormLabel fontSize="xs" color="gray.500" mb={1.5}>Signal mode</FormLabel>
              <Select
                value={thresholdMode}
                onChange={(event) => onThresholdModeChange(event.target.value as ThresholdMode)}
                data-testid="tissue-threshold-mode-select"
              >
                {THRESHOLD_MODE_OPTIONS.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </Select>
            </FormControl>
            <FormControl isDisabled={isUnsupported || isDetecting}>
              <FormLabel fontSize="xs" color="gray.500" mb={1.5}>Tissue Signal Threshold</FormLabel>
              <Input
                type="number"
                step="0.01"
                min={0}
                max={1}
                value={activationThresholdInput}
                data-testid="tissue-activation-threshold-input"
                onChange={(event) => {
                  const nextValue = event.target.value;
                  const parsedValue = parseActivationThresholdInput(nextValue);

                  if (parsedValue === null) {
                    if (/^\d*\.?\d+$/.test(nextValue)) {
                      setActivationThresholdInput(String(activationThreshold));
                      return;
                    }

                    setActivationThresholdInput(nextValue);
                    return;
                  }

                  setActivationThresholdInput(nextValue);
                  onActivationThresholdChange(parsedValue);
                }}
              />
            </FormControl>
            <FormControl isDisabled={isUnsupported || isDetecting}>
              <FormLabel fontSize="xs" color="gray.500" mb={1.5}>{blockThresholdLabel}</FormLabel>
              <Input
                type="number"
                step="1"
                min={0}
                max={255}
                value={blockThresholdInput}
                data-testid="tissue-block-threshold-input"
                onChange={(event) => {
                  const nextValue = event.target.value;
                  const parsedValue = parseBlockThresholdInput(nextValue);

                  if (parsedValue === null) {
                    if (/^\d+$/.test(nextValue)) {
                      setBlockThresholdInput(String(blockThreshold));
                      return;
                    }

                    setBlockThresholdInput(nextValue);
                    return;
                  }

                  setBlockThresholdInput(nextValue);
                  onBlockThresholdChange(parsedValue);
                }}
              />
            </FormControl>
            <Button
              data-testid="tissue-run-auto"
              colorScheme="brand"
              isLoading={isDetecting}
              loadingText="Selecting tissue spots"
              isDisabled={isUnsupported || hasInvalidLocalThresholdState}
              onClick={onRunAutoDetection}
            >
              Detect Tissue Spots
            </Button>
          </Stack>
        </CardBody>
      </Card>

      <Card border="1px solid" borderColor="gray.200" borderRadius="2xl" boxShadow="sm" bg="white">
        <CardBody p={4}>
          <Stack spacing={3}>
            <Text fontSize="sm" fontWeight="semibold">Manual Refinement</Text>
            <Button
              data-testid="tissue-show-spots-toggle"
              variant="outline"
              justifyContent="flex-start"
              isDisabled={isUnsupported || isDetecting}
              onClick={() => onShowSpotsChange(!showSpots)}
            >
              {showSpots ? 'Hide spot grid' : 'Show spot grid'}
            </Button>
            <Button
              data-testid="tissue-invert-selection"
              variant="outline"
              justifyContent="flex-start"
              isDisabled={isUnsupported || isDetecting || !hasSelectionMatrix}
              onClick={onInvertSelection}
            >
              Invert selection
            </Button>
            {TOOL_OPTIONS.map((tool) => (
              <Button
                key={tool.value}
                data-testid={`tissue-tool-${tool.value}`}
                variant={tissueTool === tool.value ? 'solid' : 'outline'}
                colorScheme={tissueTool === tool.value ? 'brand' : undefined}
                justifyContent="flex-start"
                isDisabled={isUnsupported || isDetecting}
                onClick={() => onTissueToolChange(tool.value)}
              >
                {tool.label}
              </Button>
            ))}
          </Stack>
        </CardBody>
      </Card>
    </Stack>
  );
}
