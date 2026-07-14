import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { theme } from '../../../theme';
import { CropQcPanel } from './CropQcPanel';

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}

    unobserve() {}

    disconnect() {}
  }

  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

const renderCropQcPanel = () => render(
  <ChakraProvider theme={theme}>
    <CropQcPanel
      canAccept
      canRun
      checkerboardDataUrl={null}
      cropHeight={128}
      cropWidth={256}
      eosinCropDataUrl="data:image/png;base64,AA=="
      featureMatchesDataUrl={null}
      heCropDataUrl="data:image/png;base64,BB=="
      overlayOpacity={0.42}
      onAccept={vi.fn()}
      onOverlayOpacityCommit={vi.fn()}
      onRejectToAlign={vi.fn()}
      onRunCrop={vi.fn()}
    />
  </ChakraProvider>,
);

describe('CropQcPanel copy policy', () => {
  it('preserves the dynamic overlay value in the revised review copy', async () => {
    const user = userEvent.setup();
    renderCropQcPanel();

    await user.click(screen.getByRole('tab', { name: 'Overlay View' }));

    expect(screen.getByText('Adjust the transparency of the registered H&E image to visually assess the overlap between the selected ROI and the NATA Align image.')).toBeInTheDocument();
    expect(screen.getByText('Overlay Transparency: 0.42')).toBeInTheDocument();
    expect(screen.getByAltText('Registered HE crop preview')).toBeInTheDocument();
  });
});
