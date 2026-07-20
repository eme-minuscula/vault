import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The update guard is the only thing standing between a deploy and a note the
 * user is still writing, so it is pinned down here: a waiting service-worker
 * update must NOT be applied while an editor is mounted, and must be applied
 * once that clears.
 */

const updateServiceWorker = vi.fn();
let needRefresh = true;

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [needRefresh, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker,
  }),
}));

// Not connected → the outbox is not consulted (and no IndexedDB is created).
vi.mock('../state/settings', () => ({
  useSettings: (selector: (s: unknown) => unknown) => selector({ configured: false, token: '' }),
}));

import { UpdatePrompt } from './UpdatePrompt';
import { useHoldEditorGuard } from '../state/editorGuard';

function EditorOpen() {
  useHoldEditorGuard();
  return <div>editing</div>;
}

beforeEach(() => {
  updateServiceWorker.mockClear();
  needRefresh = true;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('UpdatePrompt safety guard', () => {
  it('does NOT apply a waiting update while an editor is mounted', async () => {
    render(
      <>
        <EditorOpen />
        <UpdatePrompt />
      </>,
    );
    // The toast explains it will wait, and no reload is triggered.
    expect(await screen.findByText(/apply when you finish editing/i)).toBeInTheDocument();
    await waitFor(() => expect(updateServiceWorker).not.toHaveBeenCalled());
  });

  it('applies the update when no editor is open', async () => {
    render(<UpdatePrompt />);
    await waitFor(() => expect(updateServiceWorker).toHaveBeenCalledWith(true));
  });

  it('applies it once the editor closes', async () => {
    const { rerender } = render(
      <>
        <EditorOpen />
        <UpdatePrompt />
      </>,
    );
    await waitFor(() => expect(updateServiceWorker).not.toHaveBeenCalled());

    // Unmount the editor — the guard releases and the pending update applies.
    rerender(<UpdatePrompt />);
    await waitFor(() => expect(updateServiceWorker).toHaveBeenCalledWith(true));
  });

  it('renders nothing when there is no update waiting', () => {
    needRefresh = false;
    const { container } = render(<UpdatePrompt />);
    expect(container).toBeEmptyDOMElement();
    expect(updateServiceWorker).not.toHaveBeenCalled();
  });
});
