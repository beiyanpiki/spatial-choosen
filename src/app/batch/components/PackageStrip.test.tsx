import { ChakraProvider } from '@chakra-ui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { theme } from '@/theme';
import type { BatchPackage } from '@/types/batch';

import { PackageStrip } from './PackageStrip';

const makePackage = (id: string, name: string): BatchPackage => ({
  id,
  name,
  files: [],
  fullresFileName: null,
  positionsFileName: null,
  scalefactorsFileName: null,
  fullresSize: null,
  previewUrl: null,
  previewSize: null,
  contentBounds: null,
  spotDiameterFullres: null,
  spots: null,
  positions: null,
  resume: null,
  status: 'ready',
  error: null,
});

const renderStrip = () => {
  const onSelect = vi.fn();
  const onSetReference = vi.fn();

  render(
    <ChakraProvider theme={theme}>
      <PackageStrip
        packages={[makePackage('a', 'sample-1'), makePackage('b', 'sample-2')]}
        referencePackageId='a'
        activePackageId='b'
        onSelect={onSelect}
        onSetReference={onSetReference}
        onReorder={vi.fn()}
        testIdPrefix='strip'
      />
    </ChakraProvider>,
  );

  return { onSelect, onSetReference };
};

/**
 * Steps 3 and 4 both drive these chips, and the walkthrough also lets the
 * reference sit in the right-hand panel: the chip is the selection, the ☆ is
 * the reference.
 */
describe('PackageStrip selection', () => {
  it('selects the clicked chip, the current reference included', () => {
    const { onSelect, onSetReference } = renderStrip();

    fireEvent.click(screen.getByTestId('strip-select-sample-1'));

    expect(onSelect).toHaveBeenCalledWith('a');
    expect(onSetReference).not.toHaveBeenCalled();
  });

  it('moves the reference through the ☆ behind a chip', () => {
    const { onSelect, onSetReference } = renderStrip();

    fireEvent.click(screen.getByTestId('strip-set-reference-sample-2'));

    expect(onSetReference).toHaveBeenCalledWith('b');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows a badge instead of a ☆ on the designated chip', () => {
    renderStrip();

    expect(screen.getByTestId('strip-reference-badge-sample-1')).toBeInTheDocument();
    expect(screen.queryByTestId('strip-set-reference-sample-1')).not.toBeInTheDocument();
  });
});
