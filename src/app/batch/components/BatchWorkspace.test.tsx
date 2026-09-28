import { ChakraProvider } from '@chakra-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByRole('heading', { name: 'NATA toolkit - Multi Slides Alignment' })).toBeInTheDocument();
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

  it('shows the per-stage session bar before anything is imported', () => {
    renderWorkspace();

    // Saving has to be reachable from every step, so the bar is part of the page
    // chrome rather than one of the step panels.
    expect(screen.getByTestId('batch-autosave-status')).toHaveTextContent('仅浏览器内');
    expect(screen.getByTestId('batch-autosave-detail'))
      .toHaveTextContent('导入数据后，每次改动都会自动保存，可随时手动另存');
    expect(screen.getByTestId('batch-save-now')).toBeDisabled();
    expect(screen.getByTestId('batch-download-session')).toBeDisabled();
    expect(screen.getByTestId('batch-import-session')).toBeInTheDocument();
  });

  it('lets the operator continue a session saved by this browser', async () => {
    window.localStorage.setItem('spatial-batch-sessions-meta', JSON.stringify([{
      id: 'session-1',
      name: '睾丸空转 - 副本',
      savedAt: '2026-09-28T06:00:00.000Z',
      step: 'imageRegions',
      packageCount: 5,
      referenceName: '260206-SPA-K507',
      regionCount: 2,
      packageNames: ['260206-SPA-K507'],
    }]));

    renderWorkspace();

    expect(await screen.findByTestId('batch-recent-sessions')).toBeInTheDocument();
    expect(screen.getByText('睾丸空转 - 副本')).toBeInTheDocument();
  });

  it('names the session folder after the data folder that was picked', async () => {
    const pickerWindow = window as unknown as { showDirectoryPicker?: unknown };
    const asked: string[] = [];
    pickerWindow.showDirectoryPicker = vi.fn(async () => ({
      kind: 'directory' as const,
      name: '睾丸空转1',
      getDirectoryHandle: async (name: string) => {
        asked.push(name);
        return {
          kind: 'directory' as const,
          name,
          getDirectoryHandle: async () => { throw new Error('missing'); },
          getFileHandle: async () => { throw new Error('missing'); },
        };
      },
    }));

    try {
      renderWorkspace();
      const connect = screen.getByTestId('batch-connect-folder') as HTMLButtonElement;
      fireEvent.click(connect);

      // The folder follows the data folder (睾丸空转1), not the sample folder the
      // first package happens to live in.
      await waitFor(() => expect(asked).toEqual(['睾丸空转1-natatoolkit']));
      expect(screen.getByTestId('batch-autosave-detail'))
        .toHaveTextContent('自动保存到 睾丸空转1-natatoolkit/session.json');
    } finally {
      delete pickerWindow.showDirectoryPicker;
    }
  });
});
