import { ChakraProvider } from '@chakra-ui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { theme } from '../../../theme';
import { ExportPreviewPanel } from './ExportPreviewPanel';

const EOSIN_DATA_URL = 'data:image/png;base64,AAAA';
const HE_DATA_URL = 'data:image/png;base64,BBBB';
const SPOT_IMAGE_DATA_URL = 'data:image/png;base64,CCCC';

const renderExportPreviewPanel = (overrides: Record<string, unknown> = {}) =>
  render(
    <ChakraProvider theme={theme}>
      <ExportPreviewPanel
        eosinCropDataUrl={EOSIN_DATA_URL}
        heCropDataUrl={HE_DATA_URL}
        spotImageDataUrl={SPOT_IMAGE_DATA_URL}
        imageDimensionsSummary="640 × 640 px"
        isRenderingSpotImage={false}
        spotImageError={null}
        canPreview
        blockedReason={null}
        onContinueToExport={vi.fn()}
        {...overrides}
      />
    </ChakraProvider>,
  );

describe('ExportPreviewPanel', () => {
  it('renders the three export previews at a shared dimension summary', () => {
    renderExportPreviewPanel();

    expect(screen.getByTestId('export-preview-eosin-image')).toHaveAttribute('src', EOSIN_DATA_URL);
    expect(screen.getByTestId('export-preview-he-image')).toHaveAttribute('src', HE_DATA_URL);
    expect(screen.getByTestId('export-preview-spot-image')).toHaveAttribute('src', SPOT_IMAGE_DATA_URL);
    expect(screen.getByText('Cropped eosin image')).toBeInTheDocument();
    expect(screen.getByText('Cropped H&E image')).toBeInTheDocument();
    expect(screen.getByText('Under tissue spot')).toBeInTheDocument();
    // Captions stay limited to the image titles — no explanatory subtitles or
    // legend notes below the grid.
    expect(screen.queryByText('Registered eosin reference crop')).not.toBeInTheDocument();
    expect(screen.queryByText('Registered H&E tissue crop')).not.toBeInTheDocument();
    expect(screen.queryByText('Projected spots only, no tissue background')).not.toBeInTheDocument();
    expect(screen.queryByText(/remaining chip grid stays visible/)).not.toBeInTheDocument();
    expect(screen.getByText(/640 × 640 px/)).toBeInTheDocument();
    expect(screen.getByTestId('export-preview-status-badge')).toHaveTextContent('Ready');
  });

  it('shows a placeholder while the standalone spot image is rendering', () => {
    renderExportPreviewPanel({
      spotImageDataUrl: null,
      isRenderingSpotImage: true,
    });

    expect(screen.queryByTestId('export-preview-spot-image')).not.toBeInTheDocument();
    expect(screen.getByTestId('export-preview-spot-image-placeholder')).toHaveTextContent(
      'Preparing the standalone spot image…',
    );
    expect(screen.getByTestId('export-preview-status-badge')).toHaveTextContent('Preparing spot image');
  });

  it('surfaces rendering failures without hiding the crop previews', () => {
    renderExportPreviewPanel({
      spotImageDataUrl: null,
      spotImageError: 'Registered H&E crop image failed to load.',
    });

    expect(screen.getByTestId('export-preview-spot-image-placeholder')).toHaveTextContent(
      'Registered H&E crop image failed to load.',
    );
    expect(screen.getByTestId('export-preview-spot-image-error')).toBeInTheDocument();
    expect(screen.getByTestId('export-preview-eosin-image')).toBeInTheDocument();
    expect(screen.getByTestId('export-preview-he-image')).toBeInTheDocument();
  });

  it('shows the blocked reason and hides previews when export data is unavailable', () => {
    renderExportPreviewPanel({
      canPreview: false,
      blockedReason: 'Tissue selection is stale or incomplete.',
    });

    expect(screen.getByTestId('export-preview-blocked-reason')).toHaveTextContent(
      'Tissue selection is stale or incomplete.',
    );
    expect(screen.queryByTestId('export-preview-eosin-image')).not.toBeInTheDocument();
    expect(screen.getByTestId('export-preview-continue')).toBeDisabled();
  });

  it('continues to the export step from the primary action', () => {
    const onContinueToExport = vi.fn();
    renderExportPreviewPanel({ onContinueToExport });

    fireEvent.click(screen.getByTestId('export-preview-continue'));

    expect(onContinueToExport).toHaveBeenCalledTimes(1);
  });
});
