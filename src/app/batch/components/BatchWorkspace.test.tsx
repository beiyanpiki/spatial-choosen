import { ChakraProvider } from '@chakra-ui/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { theme } from '@/theme';

import { BatchWorkspace } from './BatchWorkspace';

// `next/link` needs an app-router context, which a unit render does not mount.
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const renderWorkspace = () => render(
  <ChakraProvider theme={theme}>
    <BatchWorkspace />
  </ChakraProvider>,
);

describe('BatchWorkspace', () => {
  it('starts on the import step with the workflow rail', () => {
    renderWorkspace();

    // The page is the multi-slide alignment workspace: "batch" is deliberately
    // absent from every operator-facing string.
    expect(screen.getByRole('heading', { name: 'Multi Slides Alignment' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Alignment workflow' })).toBeInTheDocument();
    expect(screen.getByTestId('batch-workflow-rail')).toBeInTheDocument();
    expect(screen.getByTestId('batch-step-import')).toBeInTheDocument();
    expect(screen.getByTestId('batch-drop-zone')).toBeInTheDocument();
  });

  it('gates the downstream steps until a reference region exists', () => {
    renderWorkspace();

    expect(screen.getByTestId('batch-step-import')).toBeEnabled();
    expect(screen.getByTestId('batch-step-align')).toBeDisabled();
    expect(screen.getByTestId('batch-step-reference-region')).toBeDisabled();
    expect(screen.getByTestId('batch-step-image-regions')).toBeDisabled();
    expect(screen.getByTestId('batch-step-review')).toBeDisabled();
  });

  it('keeps "batch" out of the operator-facing copy', () => {
    const { container } = renderWorkspace();

    expect(container.textContent ?? '').not.toMatch(/batch/i);
  });
});
