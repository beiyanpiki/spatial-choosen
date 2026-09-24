import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { theme } from '../../../theme';
import { ExportPanel } from './ExportPanel';

const renderExportPanel = (overrides: Record<string, unknown> = {}) => render(
  <ChakraProvider theme={theme}>
    <ExportPanel
      canExport
      includeProject
      isExporting={false}
      onDownload={vi.fn()}
      onToggleIncludeProject={vi.fn()}
      {...overrides}
    />
  </ChakraProvider>,
);

describe('ExportPanel copy policy', () => {
  it('uses the revised downstream export copy', () => {
    renderExportPanel();

    expect(screen.getByText('Download the preprocessing results required for downstream analysis in NATA Insight Bioinformatics Software.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Include NATAScope project file' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Include registered HE image' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download package' })).toBeInTheDocument();
    expect(screen.getByText('Package contents')).toBeInTheDocument();
    expect(screen.getByText('Registered H&E crop (full-res, hires, lowres)')).toBeInTheDocument();
    expect(screen.getByTestId('export-include-project')).toBeInTheDocument();
  });

  it('renders the ready status badge and summary stats by default', () => {
    renderExportPanel({
      roiSummary: '2048 × 1660 px',
      chipSummary: '15um · 78 × 128 spots',
      tissueSummary: '412 of 9,984 spots in tissue',
      outputFileName: 'Demo-preprocess.zip',
    });

    expect(screen.getByTestId('export-status-badge')).toHaveTextContent('Ready');
    expect(screen.getByTestId('export-stat-roi')).toHaveTextContent('2048 × 1660 px');
    expect(screen.getByTestId('export-stat-chip')).toHaveTextContent('15um · 78 × 128 spots');
    expect(screen.getByTestId('export-stat-tissue')).toHaveTextContent('412 of 9,984 spots in tissue');
    expect(screen.getByTestId('export-output-file-name')).toHaveTextContent('Demo-preprocess.zip');
    expect(screen.getByText('Aligned tissue image (registered overlay)')).toBeInTheDocument();
  });

  it('omits summary stats that are not provided', () => {
    renderExportPanel();

    expect(screen.queryByTestId('export-stat-roi')).not.toBeInTheDocument();
    expect(screen.queryByTestId('export-stat-chip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('export-stat-tissue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('export-output-file-name')).not.toBeInTheDocument();
  });

  it('renders the blocked reason and hides the stale notice while never exported', () => {
    renderExportPanel({
      canExport: false,
      blockedReason: 'Tissue selection is stale or incomplete.',
      isStale: true,
    });

    expect(screen.getByTestId('export-blocked-reason')).toHaveTextContent(
      'Tissue selection is stale or incomplete.',
    );
    expect(screen.getByTestId('export-status-badge')).toHaveTextContent('Blocked');
    expect(screen.getByRole('button', { name: 'Download package' })).toBeDisabled();
    expect(screen.queryByTestId('export-stale-notice')).not.toBeInTheDocument();
  });

  it('renders the stale notice and last exported time after an export', () => {
    renderExportPanel({
      isStale: true,
      lastExportedAt: '2026-04-15T08:30:00.000Z',
    });

    expect(screen.getByTestId('export-stale-notice')).toHaveTextContent(
      'Results changed since the last export',
    );
    expect(screen.getByTestId('export-status-badge')).toHaveTextContent('Updates pending');
    expect(screen.getByTestId('export-last-exported')).toHaveTextContent(
      'Last exported:',
    );
  });

  it('marks the export status as exporting while the package is prepared', () => {
    renderExportPanel({ isExporting: true });

    expect(screen.getByTestId('export-status-badge')).toHaveTextContent('Exporting');
    expect(screen.getByRole('button', { name: /Preparing package/ })).toBeDisabled();
  });

  it('dims the optional project file entry while the option is unchecked', () => {
    renderExportPanel({ includeProject: false });

    const checkbox = screen.getByRole('checkbox', { name: 'Include NATAScope project file' });
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText('NATAScope project file')).toBeInTheDocument();
    expect(screen.getByText(/Adds project.json with the source images/)).toBeInTheDocument();
  });

  it('renders neutral bullets for unconditional items and reserves checks for options', () => {
    renderExportPanel();

    // Four always-bundled artifacts use the neutral bullet; the two
    // user-controllable options (aligned image, project file) get the
    // checkmark so a green check always means "user opted in".
    expect(screen.getAllByText('•')).toHaveLength(4);
    expect(screen.getAllByText('✓')).toHaveLength(2);
  });

  it('keeps all content rows present when the project file option is unchecked', () => {
    renderExportPanel({ includeProject: false });

    // Opting out keeps the row (with a dimmed check) rather than removing it.
    expect(screen.getAllByText('•')).toHaveLength(4);
    expect(screen.getAllByText('✓')).toHaveLength(2);
  });
});
