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

const baseProps = {
  checkerboardDataUrl: null,
  cropHeight: 128,
  cropWidth: 256,
  eosinCropDataUrl: 'data:image/png;base64,AA==',
  featureMatchesDataUrl: null,
  heCropDataUrl: 'data:image/png;base64,BB==',
  overlayOpacity: 0.42,
  onAccept: vi.fn(),
  onOverlayOpacityCommit: vi.fn(),
  onRejectToAlign: vi.fn(),
  onRunCrop: vi.fn(),
};

const renderCropQcPanel = (
  overrides: Partial<Parameters<typeof CropQcPanel>[0]> = {},
) => render(
  <ChakraProvider theme={theme}>
    <CropQcPanel
      {...baseProps}
      {...overrides}
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

describe('CropQcPanel review summary', () => {
  it('surfaces the review status, registration metrics, and quality gates', () => {
    renderCropQcPanel({
      alignmentInlierRatio: 0.916,
      alignmentQualityFlags: {
        accepted: false,
        finiteMatrix: true,
        inlierRatio: true,
        minPairs: true,
        rmse: false,
        scaleRange: true,
      },
      alignmentRmse: 1.9605,
    });

    expect(screen.getByTestId('cropqc-status-badge')).toHaveTextContent('Ready to review');
    expect(screen.getByTestId('cropqc-dimensions')).toHaveTextContent('256 × 128');
    expect(screen.getByTestId('cropqc-rmse')).toHaveTextContent('1.960 px');
    expect(screen.getByTestId('cropqc-inlier-ratio')).toHaveTextContent('91.6%');
    expect(screen.getByTestId('cropqc-quality-flags')).toHaveTextContent(
      'minPairs:✓ • inlier:✓ • rmse:✗ • matrix:✓ • scale:✓',
    );
  });

  it('marks an approved review as accepted', () => {
    renderCropQcPanel({ qcAccepted: true });

    expect(screen.getByTestId('cropqc-status-badge')).toHaveTextContent('Accepted');
    expect(screen.getByTestId('cropqc-status-badge')).toHaveAttribute(
      'data-review-status',
      'accepted',
    );
  });

  it('shows the not-generated state and approval hint before a crop exists', () => {
    renderCropQcPanel({
      canAccept: false,
      checkerboardDataUrl: null,
      cropHeight: null,
      cropWidth: null,
      eosinCropDataUrl: null,
      featureMatchesDataUrl: null,
      heCropDataUrl: null,
    });

    expect(screen.getByTestId('cropqc-status-badge')).toHaveTextContent('Not generated');
    expect(screen.getByTestId('cropqc-dimensions')).toHaveTextContent('Not generated');
    expect(screen.getByText('Generate the registered ROI to enable approval.')).toBeInTheDocument();
    expect(screen.getByTestId('cropqc-accept')).toBeDisabled();
    expect(screen.getByTestId('cropqc-reject-to-align')).toBeDisabled();
  });
});
