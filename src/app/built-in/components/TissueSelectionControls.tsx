import {
  Button,
  Card,
  CardBody,
  Stack,
  Text,
} from '@chakra-ui/react';

export type TissueSelectionSupportState = 'supported' | 'unsupported';
export type TissueTool = 'activate' | 'deactivate';

type TissueSelectionControlsProps = {
	supportState: TissueSelectionSupportState;
	unsupportedReason: string | null;
	disabled?: boolean;
	tissueTool: TissueTool;
	showSpots: boolean;
	onTissueToolChange: (tool: TissueTool) => void;
	onInvertSelection: () => void;
	onShowSpotsChange: (showSpots: boolean) => void;
};

const TOOL_OPTIONS: Array<{ label: string; value: TissueTool }> = [
  { label: 'Mark as tissue', value: 'activate' },
  { label: 'Mark as background', value: 'deactivate' },
];

export function TissueSelectionControls({
	supportState,
	unsupportedReason,
	disabled = false,
	tissueTool,
	showSpots,
	onTissueToolChange,
	onInvertSelection,
	onShowSpotsChange,
}: TissueSelectionControlsProps) {
  const isUnsupported = supportState === 'unsupported';
  const isDisabled = isUnsupported || disabled;

  return (
    <Stack spacing={4}>
      {isUnsupported ? (
        <Card border="1px solid" borderColor="gray.200" borderRadius="2xl" boxShadow="sm" bg="white">
          <CardBody p={4}>
            <Stack spacing={1}>
              <Text fontSize="sm" color="orange.700">
                Tissue spot selection currently supports only 15um and 50um capture chips.
              </Text>
              {unsupportedReason ? (
                <Text fontSize="sm" color="gray.600">
                  {unsupportedReason}
                </Text>
              ) : null}
            </Stack>
          </CardBody>
        </Card>
      ) : null}

      <Card border="1px solid" borderColor="gray.200" borderRadius="2xl" boxShadow="sm" bg="white">
        <CardBody p={4}>
          <Stack spacing={3}>
            <Text fontSize="sm" fontWeight="semibold">Manual Refinement</Text>
            <Button
              data-testid="tissue-show-spots-toggle"
              variant="outline"
              justifyContent="flex-start"
              isDisabled={isDisabled}
              onClick={() => onShowSpotsChange(!showSpots)}
            >
              {showSpots ? 'Hide spot grid' : 'Show spot grid'}
            </Button>
            <Button
              data-testid="tissue-invert-selection"
              variant="outline"
              justifyContent="flex-start"
              isDisabled={isDisabled}
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
                isDisabled={isDisabled}
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
