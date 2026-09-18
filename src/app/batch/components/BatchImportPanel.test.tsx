import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { theme } from '@/theme';
import type { BatchPackage } from '@/types/batch';

import { BatchImportPanel } from './BatchImportPanel';

const packageFixture = (overrides: Partial<BatchPackage> = {}): BatchPackage => ({
  id: 'pkg-1',
  name: '250926-SPA-GW1',
  files: [],
  fullresFileName: 'spatial/tissue_fullres_image.png',
  positionsFileName: 'spatial/tissue_positions.csv',
  scalefactorsFileName: 'spatial/scalefactors_json.json',
  fullresSize: { width: 2884, height: 2884 },
  previewUrl: 'blob:preview',
  previewSize: { width: 1600, height: 1600 },
  spotDiameterFullres: 18.97,
  spots: [],
  positions: { header: ['barcode'], rows: [], columnIndex: { barcode: 0 } },
  resume: null,
  status: 'ready',
  error: null,
  ...overrides,
});

const renderPanel = (props: Partial<React.ComponentProps<typeof BatchImportPanel>> = {}) => {
  const onReferenceChange = vi.fn();
  const onSelectedFiles = vi.fn();
  const onClear = vi.fn();

  render(
    <ChakraProvider theme={theme}>
      <BatchImportPanel
        packages={[]}
        referencePackageId={null}
        busyLabel={null}
        onReferenceChange={onReferenceChange}
        onSelectedFiles={onSelectedFiles}
        onClear={onClear}
        {...props}
      />
    </ChakraProvider>,
  );

  return { onReferenceChange, onSelectedFiles, onClear };
};

describe('BatchImportPanel', () => {
  it('shows an empty state before any package is imported', () => {
    renderPanel();

    expect(screen.getByText('No packages imported yet.')).toBeInTheDocument();
    expect(screen.getByTestId('batch-drop-zone')).toBeInTheDocument();
    expect(screen.queryByTestId('batch-reference-selector')).not.toBeInTheDocument();
  });

  it('lists imported packages with their geometry', () => {
    renderPanel({ packages: [packageFixture()], referencePackageId: 'pkg-1' });

    expect(screen.getByText('250926-SPA-GW1')).toBeInTheDocument();
    expect(screen.getByText('2884×2884')).toBeInTheDocument();
    expect(screen.getByText('18.97')).toBeInTheDocument();
    expect(screen.getByText('1 package detected')).toBeInTheDocument();
  });

  it('reports failing packages with their reason', () => {
    renderPanel({
      packages: [packageFixture({ id: 'bad', name: 'broken', status: 'error', error: 'Missing tissue_positions.csv' })],
    });

    expect(screen.getByText('Missing tissue_positions.csv')).toBeInTheDocument();
    expect(screen.getByText('1 failed')).toBeInTheDocument();
  });

  it('lets the user choose which package is the reference', async () => {
    const user = userEvent.setup();
    const { onReferenceChange } = renderPanel({
      packages: [packageFixture(), packageFixture({ id: 'pkg-2', name: '250926-SPA-GW3' })],
      referencePackageId: 'pkg-1',
    });

    await user.click(screen.getByTestId('batch-reference-250926-SPA-GW3'));

    expect(onReferenceChange).toHaveBeenCalledWith('pkg-2');
  });

  it('clears the workspace through the toolbar button', async () => {
    const user = userEvent.setup();
    const { onClear } = renderPanel({ packages: [packageFixture()], referencePackageId: 'pkg-1' });

    await user.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(onClear).toHaveBeenCalled();
  });

  it('disables the reference radio for packages that failed to load', () => {
    renderPanel({ packages: [packageFixture({ status: 'error', error: 'broken' })] });

    // Chakra surfaces the disabled state on the radio control element.
    expect(screen.getByTestId('batch-reference-250926-SPA-GW1')).toHaveAttribute('data-disabled');
  });
});
