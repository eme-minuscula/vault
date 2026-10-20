import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Creating a note commits to the vault, so two of its guards are pinned here:
 * a double tap must not issue two creates, and a title that differs from an
 * existing note only by case must be refused (the vault is also checked out on
 * case-insensitive filesystems, where the two files would collide).
 */

const saveNoteText = vi.fn();
vi.mock('../../lib/vault/mutations', () => ({
  saveNoteText: (...args: unknown[]) => saveNoteText(...args) as unknown,
}));
vi.mock('../../state/client', () => ({ currentClient: () => ({}) }));
// The real visual editor loads Crepe, which jsdom can't run; the body isn't under test.
vi.mock('./WysiwygEditor', () => ({ WysiwygEditor: () => null }));

import { db } from '../../lib/cache/db';
import { toRecord } from '../../lib/sync/sync';
import { NoteEditor } from './NoteEditor';

function renderNew(create: { target: 'w' | 'm' | '_inbox'; folder: string }) {
  render(
    <MemoryRouter>
      <NoteEditor create={create} backTo="/" />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  saveNoteText.mockReset();
  await db().notes.clear();
});

describe('NoteEditor (create)', () => {
  it('issues one create for a double tap', async () => {
    let finish: () => void = () => {};
    saveNoteText.mockReturnValue(new Promise<void>((r) => (finish = r)));
    renderNew({ target: '_inbox', folder: '' });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Idea' } });

    const create = screen.getByRole('button', { name: 'Create' });
    // Both taps inside one act(): React hasn't re-rendered (and disabled the
    // button) between them, as on a fast real double tap.
    act(() => {
      create.click();
      create.click();
    });

    await waitFor(() => expect(saveNoteText).toHaveBeenCalledTimes(1));
    finish();
    expect(saveNoteText.mock.calls[0]?.[2]).toBe('_inbox/Idea.md');
  });

  it('refuses a title that only differs by case from an existing note', async () => {
    await db().notes.put(toRecord('w/PrOps/Standup.md', 'sha1', 'body'));
    renderNew({ target: 'w', folder: 'PrOps' });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'standup' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    expect(saveNoteText).not.toHaveBeenCalled();
  });
});
