'use client';

import { Button, Stack, Text } from '@chakra-ui/react';

type ExportPanelProps = {
  onDownload: () => void;
  isExporting: boolean;
  canExport: boolean;
};

export function ExportPanel({
  onDownload,
  isExporting,
  canExport,
}: ExportPanelProps) {
  return (
    <Stack spacing={4}>
      <Text color='gray.600'>Download the preprocessing results required for downstream analysis in NATA Insight Bioinformatics Software.</Text>
      <Button
        colorScheme='brand'
        onClick={onDownload}
        isLoading={isExporting}
        isDisabled={!canExport}
        data-testid='export-download-zip'
      >
        Download
      </Button>
    </Stack>
  );
}
