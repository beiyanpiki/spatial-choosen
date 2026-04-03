'use client';

import { Box, Select, Stack, Text } from '@chakra-ui/react';
import type { ChipConfigManifest } from '@/lib/preprocess/chipConfigs';
import type { ProjectedSpot } from '@/types/preprocess';

type ChipConfigPanelProps = {
  manifests: ChipConfigManifest[];
  selectedChip: string | null;
  projectedSpots: ProjectedSpot[] | null;
  eosinCropDataUrl: string | null;
  error: string | null;
  onSelectChip: (chipId: '50um' | '15um') => void;
};

export function ChipConfigPanel({
  manifests,
  selectedChip,
  projectedSpots,
  eosinCropDataUrl,
  error,
  onSelectChip,
}: ChipConfigPanelProps) {
  return (
    <Stack spacing={5}>
      <Stack spacing={2} maxW='320px'>
        <Text fontSize='sm' color='gray.600'>Square-grid chip configuration</Text>
        <Select
          value={selectedChip ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            if (value === '50um' || value === '15um') onSelectChip(value);
          }}
          data-testid='chipconfig-select'
        >
          <option value='' disabled>Select chip config…</option>
          {manifests.map((manifest) => (
            <option key={manifest.id} value={manifest.id}>{manifest.label}</option>
          ))}
        </Select>
      </Stack>

      <Text data-testid='chipconfig-spot-count' fontWeight='semibold'>
        {projectedSpots ? projectedSpots.length : 0}
      </Text>

      {error ? <Text color='red.600'>{error}</Text> : null}

      <Box position='relative' border='1px solid' borderColor='gray.200' borderRadius='lg' overflow='hidden' minH='240px' data-testid='chipconfig-stage-canvas'>
        {eosinCropDataUrl ? <img src={eosinCropDataUrl} alt='Chip projection base' style={{ display: 'block', width: '100%' }} /> : null}
        {projectedSpots?.length ? (
          <svg width='100%' height='100%' style={{ position: 'absolute', inset: 0 }}>
            <title>Chip projected spots preview</title>
            {projectedSpots.map((spot) => (
              <circle
                key={spot.id}
                cx={`${spot.x * 100}%`}
                cy={`${spot.y * 100}%`}
                r={`${Math.max(1, (spot.diameterX * 100) / 2)}%`}
                fill='rgba(49,130,206,0.25)'
                stroke='rgba(44,82,130,0.45)'
              />
            ))}
          </svg>
        ) : null}
      </Box>
    </Stack>
  );
}
