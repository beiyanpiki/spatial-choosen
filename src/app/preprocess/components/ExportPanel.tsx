'use client';

import { Button, Checkbox, Stack, Text } from '@chakra-ui/react';

type ExportPanelProps = {
  includeProject: boolean;
  includeAlignedImage: boolean;
  onToggleIncludeProject: (value: boolean) => void;
  onToggleIncludeAlignedImage: (value: boolean) => void;
  onDownload: () => void;
  isExporting: boolean;
  canExport: boolean;
};

export function ExportPanel({
  includeProject,
  includeAlignedImage,
  onToggleIncludeProject,
  onToggleIncludeAlignedImage,
  onDownload,
  isExporting,
  canExport,
}: ExportPanelProps) {
  return (
    <Stack spacing={4}>
      <Text color='gray.600'>Download the registered crop, tissue spot matrix, and metadata needed for downstream analysis.</Text>
      <Checkbox
        isChecked={includeProject}
        onChange={(event) => onToggleIncludeProject(event.target.checked)}
        data-testid='export-include-project'
      >
        Include project recovery file
      </Checkbox>
      <Checkbox
        isChecked={includeAlignedImage}
        onChange={(event) => onToggleIncludeAlignedImage(event.target.checked)}
        data-testid='export-include-aligned-image'
      >
        Include registered H&E image
      </Checkbox>
      <Button
        colorScheme='brand'
        onClick={onDownload}
        isLoading={isExporting}
        isDisabled={!canExport}
        data-testid='export-download-zip'
      >
        Download preprocessing package
      </Button>
    </Stack>
  );
}
