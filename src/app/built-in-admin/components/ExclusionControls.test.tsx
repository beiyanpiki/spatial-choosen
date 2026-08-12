import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { theme } from '../../../theme';
import { ExclusionControls } from './ExclusionControls';

const renderControls = (overrides: {
  rows?: number | null;
  columns?: number | null;
  excludedRows?: number[];
  excludedColumns?: number[];
  onExcludeRowsChange?: (next: number[]) => void;
  onExcludeColumnsChange?: (next: number[]) => void;
} = {}) => {
  const onExcludeRowsChange = vi.fn();
  const onExcludeColumnsChange = vi.fn();

  render(
    <ChakraProvider theme={theme}>
      <ExclusionControls
        rows={overrides.rows !== undefined ? overrides.rows : 4}
        columns={overrides.columns !== undefined ? overrides.columns : 4}
        excludedRows={overrides.excludedRows ?? []}
        excludedColumns={overrides.excludedColumns ?? []}
        onExcludeRowsChange={overrides.onExcludeRowsChange ?? onExcludeRowsChange}
        onExcludeColumnsChange={overrides.onExcludeColumnsChange ?? onExcludeColumnsChange}
      />
    </ChakraProvider>,
  );

  return { onExcludeRowsChange, onExcludeColumnsChange };
};

describe('ExclusionControls', () => {
  it('numbers rows from the bottom so checkbox 1 maps to the last in-memory arrayRow', async () => {
    const { onExcludeRowsChange } = renderControls({ rows: 4, columns: 4 });
    const user = userEvent.setup();

    // "Exclude rows" list: displayed 1 → in-memory arrayRow 4.
    const checkboxes = screen.getAllByRole('checkbox');
    const rowCheckboxes = checkboxes.slice(0, 4);
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

    const checkboxes = screen.getAllByRole('checkbox');
    const columnCheckboxes = checkboxes.slice(4, 8);

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

  it('renders nothing when the grid is not configured yet', () => {
    renderControls({ rows: null, columns: null });

    expect(screen.queryByText('Exclude rows')).not.toBeInTheDocument();
  });
});
