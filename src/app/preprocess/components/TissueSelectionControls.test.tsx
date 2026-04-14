import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  TissueSelectionControls,
  type ThresholdMode,
  type TissueSelectionSupportState,
  type TissueTool,
} from './TissueSelectionControls';
import { theme } from '../../../theme';

type RenderOptions = {
  thresholdMode?: ThresholdMode;
  supportState?: TissueSelectionSupportState;
  unsupportedReason?: string | null;
  isDetecting?: boolean;
  tissueTool?: TissueTool;
};

function renderControls({
  thresholdMode = 'raw',
  supportState = 'supported',
  unsupportedReason = null,
  isDetecting = false,
  tissueTool = 'activate',
}: RenderOptions = {}) {
  const onThresholdModeChange = vi.fn();
  const onTissueToolChange = vi.fn();
  const onRunAutoDetection = vi.fn();

  render(
    <ChakraProvider theme={theme}>
      <TissueSelectionControls
        thresholdMode={thresholdMode}
        supportState={supportState}
        unsupportedReason={unsupportedReason}
        isDetecting={isDetecting}
        tissueTool={tissueTool}
        onThresholdModeChange={onThresholdModeChange}
        onTissueToolChange={onTissueToolChange}
        onRunAutoDetection={onRunAutoDetection}
      />
    </ChakraProvider>,
  );

  return {
    onThresholdModeChange,
    onTissueToolChange,
    onRunAutoDetection,
  };
}

describe('TissueSelectionControls', () => {
  it('renders only activate and deactivate tools for supported chips', async () => {
    const user = userEvent.setup();
    const { onThresholdModeChange, onTissueToolChange, onRunAutoDetection } = renderControls();

    const thresholdModeSelect = screen.getByTestId('tissue-threshold-mode-select');
    expect(thresholdModeSelect).toHaveValue('raw');
    expect(screen.getByRole('option', { name: 'raw' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'gray-max' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'gray-min' })).toBeInTheDocument();

    const activateButton = screen.getByRole('button', { name: 'Activate' });
    const deactivateButton = screen.getByRole('button', { name: 'Deactivate' });
    expect(activateButton).toBeEnabled();
    expect(deactivateButton).toBeEnabled();
    expect(screen.queryByRole('button', { name: /draw/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /erase/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/selected region/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/region list/i)).not.toBeInTheDocument();

    await user.selectOptions(thresholdModeSelect, 'gray-min');
    expect(onThresholdModeChange).toHaveBeenCalledWith('gray-min');

    await user.click(screen.getByTestId('tissue-tool-activate'));
    expect(onTissueToolChange).toHaveBeenCalledWith('activate');

    await user.click(screen.getByTestId('tissue-tool-deactivate'));
    expect(onTissueToolChange).toHaveBeenCalledWith('deactivate');

    await user.click(screen.getByTestId('tissue-run-auto'));
    expect(onRunAutoDetection).toHaveBeenCalledTimes(1);
  });

  it('renders the exact unsupported message and disables all tissue-selection actions', () => {
    renderControls({
      supportState: 'unsupported',
      unsupportedReason: 'Chip size 25um is not supported.',
    });

    expect(
      screen.getByText('Tissue selection currently supports only 15um and 50um chips.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Chip size 25um is not supported.')).toBeInTheDocument();
    expect(screen.getByTestId('tissue-threshold-mode-select')).toBeDisabled();
    expect(screen.getByTestId('tissue-run-auto')).toBeDisabled();
    expect(screen.getByTestId('tissue-tool-activate')).toBeDisabled();
    expect(screen.getByTestId('tissue-tool-deactivate')).toBeDisabled();
  });
});
