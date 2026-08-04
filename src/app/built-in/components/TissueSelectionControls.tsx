import {
  Button,
  Card,
  CardBody,
  Stack,
  Text,
} from '@chakra-ui/react';

import type { ChipPlacement } from '@/types/built-in';

type TissueSelectionControlsProps = {
	disabled?: boolean;
	showSpots: boolean;
	onShowSpotsChange: (showSpots: boolean) => void;
	onResetPlacement: () => void;
	placement: ChipPlacement | null;
};

const rounded = (value: number) => Math.round(value);

export function TissueSelectionControls({
	disabled = false,
	showSpots,
	onShowSpotsChange,
	onResetPlacement,
	placement,
}: TissueSelectionControlsProps) {
  return (
    <Card border="1px solid" borderColor="gray.200" borderRadius="2xl" boxShadow="sm" bg="white">
      <CardBody p={4}>
        <Stack spacing={3}>
          <Text fontSize="sm" fontWeight="semibold">Grid placement</Text>
          <Button
            data-testid="tissue-show-spots-toggle"
            variant="outline"
            justifyContent="flex-start"
            isDisabled={disabled}
            onClick={() => onShowSpotsChange(!showSpots)}
          >
            {showSpots ? 'Hide spot grid' : 'Show spot grid'}
          </Button>
          <Button
            data-testid="tissue-reset-placement"
            variant="outline"
            justifyContent="flex-start"
            isDisabled={disabled}
            onClick={onResetPlacement}
          >
            Reset placement
          </Button>
          <Text data-testid="tissue-placement-readout" fontSize="sm" color="gray.600">
            {placement
              ? `Covered region: ${rounded(placement.size)}×${rounded(placement.size)} px at (${rounded(placement.x)}, ${rounded(placement.y)})`
              : 'Position the chip grid over the tissue.'}
          </Text>
        </Stack>
      </CardBody>
    </Card>
  );
}
