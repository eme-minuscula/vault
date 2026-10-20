import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Moving rewrites the vault (a create plus a delete), so the screen's contract
 * is pinned here: what path and text it hands to moveNote, and when it refuses.
 */

const moveNote = vi.fn();
const saveNoteText = vi.fn();
vi.mock('../../lib/vault/mutations', async (importActual) => ({
  ...(await importActual<typeof import('../../lib/vault/mutations')>()),
  moveNote: (...args: unknown[]) => moveNote(...args) as unknown,
  saveNoteText: (...args: unknown[]) => saveNoteText(...args) as unknown,
}));
// Replaced per test when the real moveNote needs a GitHub stand-in.
let client: unknown = {};
vi.mock('../../state/client', () => ({ currentClient: () => client }));

import { db } from '../../lib/cache/db';
import { GitHubError } from '../../lib/github/errors';
import { toRecord } from '../../lib/sync/sync';
import { MoveRoute } from './MoveRoute';

function renderMove(path: string) {
  render(
    <MemoryRouter initialEntries={[`/move/${path}`]}>
      <Routes>
        <Route path="/move/*" element={<MoveRoute />} />
        <Route path="/note/*" element={<p>note page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  moveNote.mockReset();
  moveNote.mockResolvedValue({ queued: false });
  saveNoteText.mockReset();
  saveNoteText.mockResolvedValue({ queued: false });
  client = {};
  await db().notes.clear();
  await db().outbox.clear();
});

describe('MoveRoute', () => {
  it('files an inbox capture: new path, Active dropped, folder type added', async () => {
    await db().notes.put(toRecord('_inbox/idea.md', 's1', '---\nactive: true\n---\n\nhi'));
    renderMove('_inbox/idea.md');

    fireEvent.click(await screen.findByRole('button', { name: 'Work' }));
    await screen.findByRole('option', { name: 'Learning' }); // folder list loaded
    fireEvent.change(screen.getByLabelText('Folder'), { target: { value: 'Learning' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    await waitFor(() => expect(moveNote).toHaveBeenCalledTimes(1));
    const [, , from, to, text] = moveNote.mock.calls[0] as unknown[];
    expect(from).toBe('_inbox/idea.md');
    expect(to).toBe('w/Learning/idea.md');
    expect(text).toBe('---\ntype: learning\n---\n\nhi');
    expect(await screen.findByText('note page')).toBeInTheDocument();
  });

  it('refuses a destination that already exists, ignoring case', async () => {
    await db().notes.put(toRecord('w/PrOps/Standup.md', 's1', 'a'));
    await db().notes.put(toRecord('w/PrOps/Daily.md', 's2', 'b'));
    renderMove('w/PrOps/Daily.md');

    const title = await screen.findByLabelText('Title');
    fireEvent.change(title, { target: { value: 'standup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    expect(moveNote).not.toHaveBeenCalled();
  });

  it('warns when notes link here and the move breaks them', async () => {
    await db().notes.put(toRecord('w/People/Alice.md', 's1', 'about Alice'));
    await db().notes.put(toRecord('w/A.md', 's2', 'see [[Alice]]'));
    renderMove('w/People/Alice.md');

    const title = await screen.findByLabelText('Title');
    fireEvent.change(title, { target: { value: 'Alicia' } });

    expect(await screen.findByText(/1 note links here/)).toBeInTheDocument();
  });

  it('only the Active flag changed: updates in place, no move', async () => {
    await db().notes.put(toRecord('w/PrOps/X.md', 's1', '---\nactive: true\n---\nbody'));
    renderMove('w/PrOps/X.md');

    fireEvent.click(await screen.findByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    await waitFor(() => expect(saveNoteText).toHaveBeenCalledTimes(1));
    expect(saveNoteText.mock.calls[0]?.slice(2)).toEqual(['w/PrOps/X.md', 'body']);
    expect(moveNote).not.toHaveBeenCalled();
  });

  it('refuses to save over a version synced after the screen opened', async () => {
    await db().notes.put(toRecord('w/PrOps/X.md', 's1', '---\nactive: true\n---\nbody'));
    renderMove('w/PrOps/X.md');
    const toggle = await screen.findByRole('switch');
    // A sync brings in an edit made elsewhere while the screen is open.
    await db().notes.put(toRecord('w/PrOps/X.md', 's2', '---\nactive: true\n---\nnewer'));

    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('changed since you opened');
    expect(saveNoteText).not.toHaveBeenCalled();
  });

  it('asks before moving between Personal and Work, and stops on No', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await db().notes.put(toRecord('m/Journaling/Day.md', 's1', 'private'));
    renderMove('m/Journaling/Day.md');

    fireEvent.click(await screen.findByRole('button', { name: 'Work' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('from Personal to Work'));
    expect(moveNote).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('refuses a rename that only changes capital letters', async () => {
    await db().notes.put(toRecord('w/PrOps/Daily.md', 's1', 'a'));
    renderMove('w/PrOps/Daily.md');

    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'daily' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('capitalisation');
    expect(moveNote).not.toHaveBeenCalled();
  });

  it('warns when another note already has the new name', async () => {
    await db().notes.put(toRecord('w/People/Alice.md', 's1', 'a'));
    await db().notes.put(toRecord('w/Old/Bob.md', 's2', 'b'));
    renderMove('w/Old/Bob.md');

    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Alice' } });

    expect(await screen.findByText(/already named “Alice”/)).toBeInTheDocument();
  });

  it('stays on screen and reports a half-done move (copy made, original kept)', async () => {
    const real = await vi.importActual<typeof import('../../lib/vault/mutations')>(
      '../../lib/vault/mutations',
    );
    moveNote.mockImplementation(real.moveNote);
    client = {
      getContent: () => Promise.resolve({ sha: 's1', content: '', encoding: 'base64' }),
      putFile: () => Promise.resolve({ content: { sha: 'n1' }, commit: { sha: 'c' } }),
      deleteFile: () => Promise.reject(new GitHubError('conflict', 'changed', 409)),
    };
    await db().notes.put(toRecord('w/PrOps/Daily.md', 's1', 'a'));
    renderMove('w/PrOps/Daily.md');

    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Copied to w/PrOps/Renamed.md, but the original',
    );
    expect(screen.getByLabelText('Title')).toHaveValue('Renamed');
  });
});
