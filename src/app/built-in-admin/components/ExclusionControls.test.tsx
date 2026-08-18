import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { theme } from '../../../theme';
import { ExclusionControls } from './ExclusionControls';

const REMOVE_ROWS_TOGGLE_LABEL = 'Remove excluded rows from export';

const rowColumnCheckboxes = () =>
  screen.getAllByRole('checkbox').filter(
    (checkbox) => checkbox.getAttribute('aria-label') !== REMOVE_ROWS_TOGGLE_LABEL,
  );

const renderControls = (overrides: {
  rows?: number | null;
  columns?: number | null;
  excludedRows?: number[];
  excludedColumns?: number[];
  removeExcludedRowsFromExport?: boolean;
  onExcludeRowsChange?: (next: number[]) => void;
  onExcludeColumnsChange?: (next: number[]) => void;
  onRemoveExcludedRowsFromExportChange?: (next: boolean) => void;
} = {}) => {
  const onExcludeRowsChange = vi.fn();
  const onExcludeColumnsChange = vi.fn();
  const onRemoveExcludedRowsFromExportChange = vi.fn();

  render(
    <ChakraProvider theme={theme}>
      <ExclusionControls
        rows={overrides.rows !== undefined ? overrides.rows : 4}
        columns={overrides.columns !== undefined ? overrides.columns : 4}
        excludedRows={overrides.excludedRows ?? []}
        excludedColumns={overrides.excludedColumns ?? []}
        removeExcludedRowsFromExport={overrides.removeExcludedRowsFromExport ?? false}
        onExcludeRowsChange={overrides.onExcludeRowsChange ?? onExcludeRowsChange}
        onExcludeColumnsChange={overrides.onExcludeColumnsChange ?? onExcludeColumnsChange}
        onRemoveExcludedRowsFromExportChange={
          overrides.onRemoveExcludedRowsFromExportChange ?? onRemoveExcludedRowsFromExportChange
        }
      />
    </ChakraProvider>,
  );

  return { onExcludeRowsChange, onExcludeColumnsChange, onRemoveExcludedRowsFromExportChange };
};

describe('ExclusionControls', () => {
  it('numbers rows from the bottom so checkbox 1 maps to the last in-memory arrayRow', async () => {
    const { onExcludeRowsChange } = renderControls({ rows: 4, columns: 4 });
    const user = userEvent.setup();

    // "Exclude rows" list: displayed 1 → in-memory arrayRow 4.
    const rowCheckboxes = rowColumnCheckboxes().slice(0, 4);
    expect(rowCheckboxes[0]).toBeInTheDocument();

    await user.click(rowCheckboxes[0]);
    expect(onExcludeRowsChange).toHaveBeenCalledWith([4]);
  });

  it('toggles columns by their displayed number directly', async () => {
    const { onExcludeColumnsChange } = renderControls({
      rows: 4,
      columns: 4,
      excludedColumns: [2],
    });
    const user = userEvent.setup();

    const columnCheckboxes = rowColumnCheckboxes().slice(4, 8);

    await user.click(columnCheckboxes[1]);
    expect(onExcludeColumnsChange).toHaveBeenCalledWith([]);
    await user.click(columnCheckboxes[0]);
    expect(onExcludeColumnsChange).toHaveBeenCalledWith([2, 1].sort((a, b) => a - b));
  });

  it('shows the excluded count and the lock semantics note', () => {
    renderControls({ rows: 4, columns: 4, excludedRows: [1, 3] });

    expect(screen.getByText('2 excluded')).toBeInTheDocument();
    expect(
      screen.getByText(/locked as inactive in tissue selection/),
    ).toBeInTheDocument();
  });

  it('renders the export row-removal toggle above Exclude rows and reports changes', async () => {
    const user = userEvent.setup();
    const { onRemoveExcludedRowsFromExportChange } = renderControls({
      rows: 4,
      columns: 4,
      removeExcludedRowsFromExport: true,
    });

    const toggle = screen.getByLabelText(REMOVE_ROWS_TOGGLE_LABEL);
    expect(toggle).toBeInTheDocument();
    expect(toggle).toBeChecked();

    // The toggle sits directly above the "Exclude rows" list.
    const toggleCard = toggle.closest('label');
    const rowsHeading = screen.getByText('Exclude rows');
    expect(toggleCard).not.toBeNull();
    expect(
      toggleCard!.compareDocumentPosition(rowsHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);

    await user.click(toggle);
    expect(onRemoveExcludedRowsFromExportChange).toHaveBeenCalledWith(false);
  });

  it('hides the export row-removal toggle when the grid is not configured yet', () => {
    renderControls({ rows: null, columns: null });

    expect(
      screen.queryByTestId('exclusion-remove-rows-from-export-toggle'),
    ).not.toBeInTheDocument();
  });

  it('renders nothing when the grid is not configured yet', () => {
    renderControls({ rows: null, columns: null });

    expect(screen.queryByText('Exclude rows')).not.toBeInTheDocument();
  });
});
