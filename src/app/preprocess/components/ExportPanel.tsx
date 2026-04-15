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
      <Text color='gray.600'>Package processed outputs for downstream workflows.</Text>
      <Checkbox
        isChecked={includeProject}
        onChange={(event) => onToggleIncludeProject(event.target.checked)}
        data-testid='export-include-project'
      >
        Include recovery project
      </Checkbox>
      <Checkbox
        isChecked={includeAlignedImage}
        onChange={(event) => onToggleIncludeAlignedImage(event.target.checked)}
        data-testid='export-include-aligned-image'
      >
        Include aligned HE image
      </Checkbox>
      <Button
        colorScheme='brand'
        onClick={onDownload}
        isLoading={isExporting}
        isDisabled={!canExport}
        data-testid='export-download-zip'
      >
        Download preprocess ZIP
      </Button>
    </Stack>
  );
}
