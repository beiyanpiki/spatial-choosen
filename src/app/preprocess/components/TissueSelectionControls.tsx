import {
  Button,
  Card,
  CardBody,
  FormControl,
  FormLabel,
  Select,
  Stack,
  Text,
} from '@chakra-ui/react';

export type ThresholdMode = 'raw' | 'gray-max' | 'gray-min';
export type TissueSelectionSupportState = 'supported' | 'unsupported';
export type TissueTool = 'activate' | 'deactivate';

type TissueSelectionControlsProps = {
  thresholdMode: ThresholdMode;
  supportState: TissueSelectionSupportState;
  unsupportedReason: string | null;
  isDetecting: boolean;
  tissueTool: TissueTool;
  onThresholdModeChange: (mode: ThresholdMode) => void;
  onTissueToolChange: (tool: TissueTool) => void;
  onRunAutoDetection: () => void;
};

const THRESHOLD_MODE_OPTIONS: ThresholdMode[] = ['raw', 'gray-max', 'gray-min'];
const TOOL_OPTIONS: Array<{ label: string; value: TissueTool }> = [
  { label: 'Activate', value: 'activate' },
  { label: 'Deactivate', value: 'deactivate' },
];

export function TissueSelectionControls({
  thresholdMode,
  supportState,
  unsupportedReason,
  isDetecting,
  tissueTool,
  onThresholdModeChange,
  onTissueToolChange,
  onRunAutoDetection,
}: TissueSelectionControlsProps) {
  const isUnsupported = supportState === 'unsupported';

  return (
    <Stack spacing={4}>
      <Card border="1px solid" borderColor="gray.200" borderRadius="2xl" boxShadow="sm" bg="white">
        <CardBody p={4}>
          <Stack spacing={4}>
            <Text fontSize="sm" fontWeight="semibold">Auto detection</Text>
            {isUnsupported ? (
              <Stack spacing={1}>
                <Text fontSize="sm" color="orange.700">
                  Tissue selection currently supports only 15um and 50um chips.
                </Text>
                {unsupportedReason ? (
                  <Text fontSize="sm" color="gray.600">
                    {unsupportedReason}
                  </Text>
                ) : null}
              </Stack>
            ) : null}
            <FormControl isDisabled={isUnsupported || isDetecting}>
              <FormLabel fontSize="xs" color="gray.500" mb={1.5}>Threshold mode</FormLabel>
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
            <Button
              data-testid="tissue-run-auto"
              colorScheme="brand"
              isLoading={isDetecting}
              loadingText="Detecting tissue"
              isDisabled={isUnsupported}
              onClick={onRunAutoDetection}
            >
              Run auto detection
            </Button>
          </Stack>
        </CardBody>
      </Card>

      <Card border="1px solid" borderColor="gray.200" borderRadius="2xl" boxShadow="sm" bg="white">
        <CardBody p={4}>
          <Stack spacing={3}>
            <Text fontSize="sm" fontWeight="semibold">Selection controls</Text>
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
