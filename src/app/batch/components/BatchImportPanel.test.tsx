import { ChakraProvider } from '@chakra-ui/react';
import { fireEvent, render, screen } from '@testing-library/react';
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
  contentBounds: null,
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
  const onReorder = vi.fn();

  render(
    <ChakraProvider theme={theme}>
      <BatchImportPanel
        packages={[]}
        referencePackageId={null}
        busyLabel={null}
        onReferenceChange={onReferenceChange}
        onSelectedFiles={onSelectedFiles}
        onClear={onClear}
        onReorder={onReorder}
        {...props}
      />
    </ChakraProvider>,
  );

  return { onReferenceChange, onSelectedFiles, onClear, onReorder };
};

describe('BatchImportPanel', () => {
  const summary = {
    id: 'session-1',
    name: '睾丸空转 - 副本',
    savedAt: '2026-09-28T06:00:00.000Z',
    step: 'imageRegions' as const,
    packageCount: 5,
    referenceName: '260206-SPA-K507',
    regionCount: 2,
    packageNames: ['260206-SPA-K507'],
  };

  it('offers to continue the last saved session', () => {
    const onContinueSession = vi.fn();
    const onDeleteSession = vi.fn();
    renderPanel({ recentSessions: [summary], onContinueSession, onDeleteSession });

    expect(screen.getByTestId('batch-recent-sessions')).toBeInTheDocument();
    expect(screen.getByText('睾丸空转 - 副本')).toBeInTheDocument();

    // `fireEvent`, not `userEvent`: the latter's focus tracking clashes with the
    // zag focus-visible polyfill the radio group installs.
    fireEvent.click(screen.getByTestId('batch-continue-session-1'));
    expect(onContinueSession).toHaveBeenCalledWith(summary);

    fireEvent.click(screen.getByText('删除记录'));
    expect(onDeleteSession).toHaveBeenCalledWith(summary);
  });

  it('hides the continue card when this browser has no saved session', () => {
    renderPanel();

    expect(screen.queryByTestId('batch-recent-sessions')).not.toBeInTheDocument();
  });

  it('keeps the folder picker working after the saved-session card appears', () => {
    const renderWithSessions = (recentSessions: typeof summary[]) => (
      <ChakraProvider theme={theme}>
        <BatchImportPanel
          packages={[]}
          referencePackageId={null}
          busyLabel={null}
          onReferenceChange={vi.fn()}
          onSelectedFiles={vi.fn()}
          onClear={vi.fn()}
          onReorder={vi.fn()}
          recentSessions={recentSessions}
          onContinueSession={vi.fn()}
        />
      </ChakraProvider>
    );

    // The summaries arrive one tick after mount, which inserts the card above the
    // inputs; `webkitdirectory` has to survive that re-render or Chrome turns the
    // folder picker into a plain file picker.
    const { rerender } = render(renderWithSessions([]));
    expect(screen.getByTestId('batch-folder-input')).toHaveAttribute('webkitdirectory');

    rerender(renderWithSessions([summary]));

    expect(screen.getByTestId('batch-folder-input')).toHaveAttribute('webkitdirectory');
  });

  it('disables the auto-saving folder picker when the browser cannot write folders', () => {
    renderPanel({ onPickDataFolder: vi.fn() });

    // jsdom has no showDirectoryPicker, so the button explains itself instead of
    // pretending the folder can be written to.
    expect(screen.getByTestId('batch-data-folder-button')).toBeDisabled();
  });

  it('opens the folder input while its directory flag is intact', () => {
    const onPickDataFolder = vi.fn();
    renderPanel({ onPickDataFolder });
    const input = screen.getByTestId('batch-folder-input') as HTMLInputElement;
    const clicked = vi.fn();
    input.addEventListener('click', clicked);

    fireEvent.click(screen.getByTestId('batch-select-folder'));

    expect(clicked).toHaveBeenCalledTimes(1);
    expect(onPickDataFolder).not.toHaveBeenCalled();
  });

  it('falls back to the directory dialog if the input lost its directory flag', () => {
    const onPickDataFolder = vi.fn();
    const pickerWindow = window as unknown as { showDirectoryPicker?: unknown };
    pickerWindow.showDirectoryPicker = vi.fn();

    try {
      renderPanel({ onPickDataFolder });
      const input = screen.getByTestId('batch-folder-input') as HTMLInputElement;
      // Without `webkitdirectory` the same input would open a file dialog, which
      // cannot select a package folder at all.
      input.removeAttribute('webkitdirectory');
      const clicked = vi.fn();
      input.addEventListener('click', clicked);

      fireEvent.click(screen.getByTestId('batch-select-folder'));

      expect(onPickDataFolder).toHaveBeenCalledTimes(1);
      expect(clicked).not.toHaveBeenCalled();
    } finally {
      delete pickerWindow.showDirectoryPicker;
    }
  });

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

  it('moves rows with the arrow buttons and hides the impossible direction', async () => {
    const user = userEvent.setup();
    const { onReorder } = renderPanel({
      packages: [
        packageFixture(),
        packageFixture({ id: 'pkg-2', name: '250926-SPA-GW3' }),
        packageFixture({ id: 'pkg-3', name: '251103-SPA-hT05' }),
      ],
      referencePackageId: 'pkg-1',
    });

    // First row can only go down, last row only up, the middle row both ways.
    expect(screen.queryByTestId('batch-package-up-250926-SPA-GW1')).not.toBeInTheDocument();
    expect(screen.getByTestId('batch-package-down-250926-SPA-GW1')).toBeInTheDocument();
    expect(screen.getByTestId('batch-package-up-250926-SPA-GW3')).toBeInTheDocument();
    expect(screen.getByTestId('batch-package-down-250926-SPA-GW3')).toBeInTheDocument();
    expect(screen.getByTestId('batch-package-up-251103-SPA-hT05')).toBeInTheDocument();
    expect(screen.queryByTestId('batch-package-down-251103-SPA-hT05')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('batch-package-up-251103-SPA-hT05'));
    expect(onReorder).toHaveBeenCalledWith('pkg-3', 1);

    await user.click(screen.getByTestId('batch-package-down-250926-SPA-GW1'));
    expect(onReorder).toHaveBeenCalledWith('pkg-1', 1);
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
