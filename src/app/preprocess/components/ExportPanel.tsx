'use client';

import { Button, Checkbox, Stack, Text } from '@chakra-ui/react';

type ExportPanelProps = {
  includeProject: boolean;
  onToggleIncludeProject: (value: boolean) => void;
  onDownload: () => void;
  isExporting: boolean;
  canExport: boolean;
};

export function ExportPanel({
  includeProject,
  onToggleIncludeProject,
  onDownload,
  isExporting,
  canExport,
}: ExportPanelProps) {
  return (
    <Stack spacing={4}>
      <Text color='gray.600'>Download the preprocessing results required for downstream analysis in NATA Insight Bioinformatics Software.</Text>
      <Checkbox
        isChecked={includeProject}
        onChange={(event) => onToggleIncludeProject(event.target.checked)}
        data-testid='export-include-project'
      >
        Include NATAScope project file
      </Checkbox>
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
