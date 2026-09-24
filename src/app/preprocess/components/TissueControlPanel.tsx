import {
  Box,
  Button,
  ButtonGroup,
  Card,
  CardBody,
  Divider,
  FormControl,
  FormLabel,
  HStack,
  Input,
  SimpleGrid,
  Stack,
  Text,
} from '@chakra-ui/react';
import { useEffect, useState } from 'react';

import type { TissueSpotStyle } from '@/types/preprocess';

export type ThresholdMode = 'raw' | 'gray-max' | 'gray-min';
export type TissueSelectionSupportState = 'supported' | 'unsupported';
export type TissueTool = 'activate' | 'deactivate';

type TissueControlPanelProps = {
  // Spot style palette
  spotStyle: TissueSpotStyle;
  onSpotStyleChange: (style: TissueSpotStyle) => void;
  // Detection feedback (rendered inside the automatic detection section)
  detectionWarning: string | null;
  detectionStatus: string;
  // Chip configuration
  chipType: string | null;
  chipOptions: readonly string[];
  isChipSelectorDisabled: boolean;
  onChipTypeChange: (chipId: string) => void;
  chipBlockedReason: string | null;
  chipError: string | null;
  // Automatic detection
  thresholdMode: ThresholdMode;
  activationThreshold: number;
  blockThreshold: number;
  supportState: TissueSelectionSupportState;
  unsupportedReason: string | null;
  isDetecting: boolean;
  onThresholdModeChange: (mode: ThresholdMode) => void;
  onActivationThresholdChange: (value: number) => void;
  onBlockThresholdChange: (value: number) => void;
  onRunAutoDetection: () => void;
  // Manual refinement
  tissueTool: TissueTool;
  showSpots: boolean;
  onTissueToolChange: (tool: TissueTool) => void;
  onInvertSelection: () => void;
  onShowSpotsChange: (showSpots: boolean) => void;
};

const THRESHOLD_MODE_OPTIONS: ThresholdMode[] = ['raw', 'gray-max', 'gray-min'];
const TOOL_OPTIONS: Array<{ label: string; value: TissueTool }> = [
  { label: 'Tissue', value: 'activate' },
  { label: 'Background', value: 'deactivate' },
];

const SPOT_STYLE_PRESETS: readonly string[] = [
  '#38A169',
  '#3182CE',
  '#805AD5',
  '#DD6B20',
  '#E53E3E',
  '#319795',
  '#D53F8C',
  '#D69E2E',
  '#2D3748',
  '#718096',
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

function SectionLabel({ children }: { children: string }) {
  return (
    <Text fontSize="xs" textTransform="uppercase" letterSpacing="0.12em" color="gray.500">
      {children}
    </Text>
  );
}

export function TissueControlPanel({
  spotStyle,
  onSpotStyleChange,
  detectionWarning,
  detectionStatus,
  chipType,
  chipOptions,
  isChipSelectorDisabled,
  onChipTypeChange,
  chipBlockedReason,
  chipError,
  thresholdMode,
  activationThreshold,
  blockThreshold,
  supportState,
  unsupportedReason,
  isDetecting,
  onThresholdModeChange,
  onActivationThresholdChange,
  onBlockThresholdChange,
  onRunAutoDetection,
  tissueTool,
  showSpots,
  onTissueToolChange,
  onInvertSelection,
  onShowSpotsChange,
}: TissueControlPanelProps) {
  const isUnsupported = supportState === 'unsupported';
  const [activationThresholdInput, setActivationThresholdInput] = useState(() => String(activationThreshold));
  const [blockThresholdInput, setBlockThresholdInput] = useState(() => String(blockThreshold));
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState('');
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
    <Card border="1px solid" borderColor="gray.200" borderRadius="2xl" boxShadow="sm" bg="white" overflow="hidden">
      <CardBody p={0}>
        <Stack spacing={0} divider={<Divider />}>
          {/* Spot style palette: [color] [opacity slider], applies to the
              currently selected tissue spots. The palette popover is rendered
              in-page because native color pickers do not open reliably in the
              instrument browsers this app targets. */}
          <Stack px={4} py={4} spacing={2}>
            <SectionLabel>Spot style</SectionLabel>
            <HStack spacing={3} align="center">
              <Box position="relative">
                <Button
                  aria-label="Spot color"
                  aria-expanded={isPaletteOpen}
                  w={10}
                  h={8}
                  p={0}
                  minW={10}
                  bg={spotStyle.color}
                  border="1px solid"
                  borderColor="gray.200"
                  title={spotStyle.color}
                  data-testid="tissue-style-color"
                  onClick={() => {
                    setHexDraft("");
                    setIsPaletteOpen((open) => !open);
                  }}
                />
                {isPaletteOpen ? (
                  <>
                    <Box
                      position="fixed"
                      inset={0}
                      zIndex={1}
                      onClick={() => setIsPaletteOpen(false)}
                      data-testid="tissue-style-palette-backdrop"
                    />
                    <Box
                      position="absolute"
                      top="calc(100% + 4px)"
                      left={0}
                      zIndex={2}
                      w="220px"
                      p={3}
                      bg="white"
                      border="1px solid"
                      borderColor="gray.200"
                      borderRadius="lg"
                      boxShadow="lg"
                      data-testid="tissue-style-palette"
                    >
                      <Text fontSize="xs" color="gray.500" mb={2}>
                        Palette
                      </Text>
                      <SimpleGrid columns={5} spacing={2} mb={3}>
                        {SPOT_STYLE_PRESETS.map((preset) => (
                          <Button
                            key={preset}
                            aria-label={`Use color ${preset}`}
                            w={8}
                            h={8}
                            minW={8}
                            p={0}
                            bg={preset}
                            variant="unstyled"
                            border="1px solid"
                            borderColor={
                              spotStyle.color.toLowerCase() === preset.toLowerCase()
                                ? 'gray.800'
                                : 'gray.200'
                            }
                            onClick={() => {
                              onSpotStyleChange({ ...spotStyle, color: preset });
                              setIsPaletteOpen(false);
                            }}
                            data-testid={`tissue-style-swatch-${preset.slice(1).toLowerCase()}`}
                          />
                        ))}
                      </SimpleGrid>
                      <HStack spacing={2}>
                        <Input
                          size="sm"
                          value={hexDraft}
                          placeholder="#38A169"
                          aria-label="Spot hex color"
                          data-testid="tissue-style-hex-input"
                          onChange={(event) => {
                            const draft = event.target.value;
                            setHexDraft(draft);
                            if (/^#[0-9a-fA-F]{6}$/.test(draft.trim())) {
                              onSpotStyleChange({
                                ...spotStyle,
                                color: draft.trim().toUpperCase(),
                              });
                            }
                          }}
                        />
                      </HStack>
                    </Box>
                  </>
                ) : null}
              </Box>
              <Input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(spotStyle.opacity * 100)}
                flex={1}
                sx={{ accentColor: 'brand.500', paddingX: 0 }}
                aria-label="Spot opacity"
                title="Opacity"
                data-testid="tissue-style-opacity-slider"
                onChange={(event) =>
                  onSpotStyleChange({
                    ...spotStyle,
                    opacity: Number(event.target.value) / 100,
                  })
                }
              />
              <Text fontSize="xs" color="gray.600" w={9} textAlign="right" data-testid="tissue-style-opacity-value">
                {Math.round(spotStyle.opacity * 100)}%
              </Text>
            </HStack>
            <Text fontSize="xs" color="gray.500">
              Applies to the selected tissue spots.
            </Text>
          </Stack>

          {/* Chip configuration */}
          <Stack px={4} py={4} spacing={2.5}>
            <SectionLabel>Chip</SectionLabel>
            <FormControl isDisabled={isChipSelectorDisabled}>
              <FormLabel fontSize="xs" color="gray.500" mb={1.5}>
                Spot size
              </FormLabel>
              <ButtonGroup isAttached variant="outline" w="100%" data-testid="tissue-chip-size-control">
                {chipOptions.map((chipId) => (
                  <Button
                    key={chipId}
                    flex={1}
                    size="sm"
                    variant={chipType === chipId ? 'solid' : 'outline'}
                    colorScheme={chipType === chipId ? 'brand' : 'gray'}
                    aria-pressed={chipType === chipId}
                    isDisabled={isChipSelectorDisabled}
                    onClick={() => onChipTypeChange(chipId)}
                    data-testid={`tissue-chip-size-option-${chipId}`}
                  >
                    {chipId}
                  </Button>
                ))}
              </ButtonGroup>
            </FormControl>
            {chipBlockedReason ? (
              <Text fontSize="xs" color="orange.600">
                {chipBlockedReason}
              </Text>
            ) : null}
            {chipError ? (
              <Text fontSize="sm" color="red.600">
                {chipError}
              </Text>
            ) : null}
          </Stack>

          {/* Automatic detection */}
          <Stack px={4} py={4} spacing={3}>
            <SectionLabel>Automatic detection</SectionLabel>
            {detectionWarning ? (
              <Text fontSize="sm" color="orange.700" data-testid="tissue-detection-warning">
                {detectionWarning}
              </Text>
            ) : (
              <Text fontSize="sm" color="gray.500" data-testid="tissue-detection-status">
                {detectionStatus}
              </Text>
            )}
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
              {/* Segmented buttons instead of a native select: dropdowns do not
                  open reliably in the instrument browsers this app targets. */}
              <ButtonGroup
                isAttached
                w="100%"
                variant="outline"
                data-testid="tissue-threshold-mode-select"
              >
                {THRESHOLD_MODE_OPTIONS.map((mode) => (
                  <Button
                    key={mode}
                    flex={1}
                    size="sm"
                    variant={thresholdMode === mode ? 'solid' : 'outline'}
                    colorScheme={thresholdMode === mode ? 'brand' : 'gray'}
                    aria-pressed={thresholdMode === mode}
                    isDisabled={isUnsupported || isDetecting}
                    onClick={() => onThresholdModeChange(mode)}
                    data-testid={`tissue-threshold-mode-option-${mode}`}
                  >
                    {mode}
                  </Button>
                ))}
              </ButtonGroup>
            </FormControl>
            <SimpleGrid columns={2} spacing={3} alignItems="end">
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
            </SimpleGrid>
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

          {/* Manual refinement */}
          <Stack px={4} py={4} spacing={3}>
            <SectionLabel>Manual refinement</SectionLabel>
            <HStack justify="space-between" align="center" gap={3}>
              <FormLabel mb={0} fontSize="sm" color="gray.700">
                Spot grid
              </FormLabel>
              {/* A switch-styled button: Chakra's Switch crashes under
                  user-event's focus patching in tests, and the two states map
                  cleanly onto a pill toggle. */}
              <Button
                role="switch"
                aria-checked={showSpots}
                size="xs"
                minW="16"
                variant={showSpots ? 'solid' : 'outline'}
                colorScheme={showSpots ? 'brand' : 'gray'}
                isDisabled={isUnsupported || isDetecting}
                onClick={() => onShowSpotsChange(!showSpots)}
                data-testid="tissue-show-spots-toggle"
              >
                {showSpots ? 'On' : 'Off'}
              </Button>
            </HStack>
            <Button
              w="100%"
              variant="outline"
              isDisabled={isUnsupported || isDetecting}
              onClick={onInvertSelection}
              data-testid="tissue-invert-selection"
            >
              Invert selection
            </Button>
            <Box>
              <Text fontSize="xs" color="gray.500" mb={1.5}>Mark spots as</Text>
              <ButtonGroup w="100%">
                {TOOL_OPTIONS.map((tool) => (
                  <Button
                    key={tool.value}
                    flex={1}
                    size="sm"
                    variant={tissueTool === tool.value ? 'solid' : 'outline'}
                    colorScheme={tissueTool === tool.value ? 'brand' : 'gray'}
                    aria-pressed={tissueTool === tool.value}
                    isDisabled={isUnsupported || isDetecting}
                    onClick={() => onTissueToolChange(tool.value)}
                    data-testid={`tissue-tool-${tool.value}`}
                  >
                    {tool.label}
                  </Button>
                ))}
              </ButtonGroup>
            </Box>
          </Stack>
        </Stack>
      </CardBody>
    </Card>
  );
}
