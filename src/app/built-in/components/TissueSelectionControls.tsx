import {
  Box,
  Button,
  Card,
  CardBody,
  SimpleGrid,
  Stack,
  Text,
} from '@chakra-ui/react';

type BlockRect = { width: number; height: number };

type TissueSelectionControlsProps = {
	disabled?: boolean;
	showSpots: boolean;
	onShowSpotsChange: (showSpots: boolean) => void;
	onResetPlacement: () => void;
	blockRect: BlockRect | null;
	rows: number;
	columns: number;
	excludedRows: number[];
	excludedColumns: number[];
	onExcludeRowsChange: (next: number[]) => void;
	onExcludeColumnsChange: (next: number[]) => void;
};

const rounded = (value: number) => Math.round(value);

const toggle = (list: number[], value: number): number[] => {
	const next = new Set(list);
	if (next.has(value)) {
		next.delete(value);
	} else {
		next.add(value);
	}
	return [...next].sort((a, b) => a - b);
};

function ExclusionList({
	label,
	count,
	excluded,
	onChange,
	disabled,
}: {
	label: string;
	count: number;
	excluded: number[];
	onChange: (next: number[]) => void;
	disabled?: boolean;
}) {
	if (count <= 0) return null;
	const excludedSet = new Set(excluded);

	return (
		<Card border="1px solid" borderColor="gray.200" borderRadius="2xl" boxShadow="sm" bg="white">
			<CardBody p={4}>
				<Stack spacing={3}>
					<Text fontSize="sm" fontWeight="semibold">{label}</Text>
					<Box maxHeight="200px" overflowY="auto" pr={1}>
						<SimpleGrid columns={6} spacing={2}>
							{Array.from({ length: count }, (_, index) => index + 1).map((value) => (
								<label
									key={value}
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: '0.35rem',
										fontSize: 'sm',
										cursor: disabled ? 'not-allowed' : 'pointer',
									}}
								>
									<input
										type="checkbox"
										disabled={disabled}
										checked={excludedSet.has(value)}
										onChange={() => onChange(toggle(excluded, value))}
									/>
									<span>{value}</span>
								</label>
							))}
						</SimpleGrid>
					</Box>
					<Text fontSize="xs" color="gray.500">{excluded.length} excluded</Text>
				</Stack>
			</CardBody>
		</Card>
	);
}

export function TissueSelectionControls({
	disabled = false,
	showSpots,
	onShowSpotsChange,
	onResetPlacement,
	blockRect,
	rows,
	columns,
	excludedRows,
	excludedColumns,
	onExcludeRowsChange,
	onExcludeColumnsChange,
}: TissueSelectionControlsProps) {
  return (
    <Stack spacing={4}>
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
              {blockRect
                ? `Covered region: ${rounded(blockRect.width)}×${rounded(blockRect.height)} px`
                : 'Position the chip grid over the tissue.'}
            </Text>
          </Stack>
        </CardBody>
      </Card>

      <ExclusionList
        label="Exclude rows"
        count={rows}
        excluded={excludedRows}
        onChange={onExcludeRowsChange}
        disabled={disabled}
      />
      <ExclusionList
        label="Exclude columns"
        count={columns}
        excluded={excludedColumns}
        onChange={onExcludeColumnsChange}
        disabled={disabled}
      />
    </Stack>
  );
}
