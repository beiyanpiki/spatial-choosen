'use client';

import { Box, Stack, Text } from '@chakra-ui/react';
import type { ChipConfigManifest } from '@/lib/built-in-admin/chipConfigs';
import type { ProjectedSpot } from '@/types/built-in-admin';

type ChipConfigPanelProps = {
  manifests: ChipConfigManifest[];
  selectedChip: string | null;
  projectedSpots: ProjectedSpot[] | null;
  eosinCropDataUrl: string | null;
  error: string | null;
};

export function ChipConfigPanel({
  manifests,
  selectedChip,
  projectedSpots,
  eosinCropDataUrl,
  error,
}: ChipConfigPanelProps) {
  const selectedManifest = manifests.find((manifest) => manifest.id === selectedChip) ?? null;

  return (
    <Stack spacing={5}>
      <Stack spacing={2} maxW='420px'>
        <Text fontSize='sm' color='gray.600'>Projected capture spot grid</Text>
        <Text fontSize='sm' color='gray.500' data-testid='chipconfig-selected-chip'>
          {selectedManifest?.label ?? 'Choose the capture pitch in Tissue spots to project the spot grid.'}
        </Text>
      </Stack>

      <Text data-testid='chipconfig-spot-count' fontWeight='semibold'>
        {projectedSpots ? projectedSpots.length : 0}
      </Text>

      {error ? <Text color='red.600'>{error}</Text> : null}

      <Box position='relative' border='1px solid' borderColor='gray.200' borderRadius='lg' overflow='hidden' minH='240px' data-testid='chipconfig-stage-canvas'>
        {eosinCropDataUrl ? <img src={eosinCropDataUrl} alt='Eosin crop used for spot projection' style={{ display: 'block', width: '100%' }} /> : null}
        {projectedSpots?.length ? (
          <svg width='100%' height='100%' style={{ position: 'absolute', inset: 0 }}>
            <title>Projected capture spots preview</title>
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
