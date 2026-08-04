import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { theme } from '../../../theme';
import { ExportPanel } from './ExportPanel';

const renderExportPanel = (overrides: Partial<Parameters<typeof ExportPanel>[0]> = {}) => render(
  <ChakraProvider theme={theme}>
    <ExportPanel
      canExport
      isExporting={false}
      onDownload={vi.fn()}
      {...overrides}
    />
  </ChakraProvider>,
);

describe('ExportPanel copy policy', () => {
  it('uses the preprocess export copy without the project-file checkbox', () => {
    renderExportPanel();

    expect(screen.getByText('Download the preprocessing results required for downstream analysis in NATA Insight Bioinformatics Software.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    // The built-in ZIP has no NATAScope project.json, so no checkbox is shown.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('disables the download button while blocked', () => {
    renderExportPanel({ canExport: false });

    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
  });

  it('runs the download callback on click', () => {
    const onDownload = vi.fn();
    renderExportPanel({ onDownload });

    screen.getByRole('button', { name: 'Download' }).click();

    expect(onDownload).toHaveBeenCalledTimes(1);
  });
});
