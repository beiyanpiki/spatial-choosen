import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { theme } from '../../../theme';
import { ExportPanel } from './ExportPanel';

const renderExportPanel = () => render(
  <ChakraProvider theme={theme}>
    <ExportPanel
      canExport
      includeProject
      isExporting={false}
      onDownload={vi.fn()}
      onToggleIncludeProject={vi.fn()}
    />
  </ChakraProvider>,
);

describe('ExportPanel copy policy', () => {
  it('uses the revised downstream export copy', () => {
    renderExportPanel();

    expect(screen.getByText('Download the preprocessing results required for downstream analysis in NATA Insight Bioinformatics Software.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Include NATAScope project file' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Include registered HE image' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });
});
