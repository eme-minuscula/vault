import { describe, expect, it } from 'vitest';
import { excerpt, searchNotes, tokenize } from './search';
import type { NoteRecord } from '../cache/db';

function note(p: Partial<NoteRecord> & { path: string }): NoteRecord {
  return {
    path: p.path,
    sha: 's',
    vault: p.vault ?? 'w',
    folder: p.folder ?? '',
    title: p.title ?? p.path,
    type: p.type ?? null,
    tags: p.tags ?? [],
    active: p.active ?? false,
    date: p.date ?? null,
    snippet: p.snippet ?? '',
    body: p.body ?? '',
    updatedAt: 0,
  };
}

const notes: NoteRecord[] = [
  note({
    path: 'w/Communication.md',
    title: 'Communication',
    body: 'settle an agenda',
    tags: ['clarity'],
  }),
  note({
    path: 'w/Agenda.md',
    title: 'Agenda template',
    body: 'reusable meeting agenda',
    type: 'learning',
  }),
  note({
    path: 'r/Tortilla.md',
    title: 'Tortilla',
    vault: 'r',
    body: 'eggs and potatoes',
    tags: ['dinner'],
  }),
  note({
    path: 'm/Today.md',
    title: 'Today',
    vault: 'm',
    active: true,
    body: 'agenda for the day',
  }),
];

describe('searchNotes', () => {
  it('ranks title matches above body matches', () => {
    const hits = searchNotes(notes, 'agenda');
    expect(hits[0]?.note.path).toBe('w/Agenda.md'); // title hit outranks body hits
    expect(hits.map((h) => h.note.path)).toContain('w/Communication.md');
  });

  it('AND-matches all terms', () => {
    expect(searchNotes(notes, 'meeting agenda').map((h) => h.note.path)).toEqual(['w/Agenda.md']);
    expect(searchNotes(notes, 'agenda unicorn')).toEqual([]);
  });

  it('matches tags and type', () => {
    expect(searchNotes(notes, 'dinner').map((h) => h.note.path)).toEqual(['r/Tortilla.md']);
    expect(searchNotes(notes, 'learning').map((h) => h.note.path)).toEqual(['w/Agenda.md']);
  });

  it('applies vault and active filters', () => {
    expect(searchNotes(notes, 'agenda', { vault: 'r' })).toEqual([]);
    const active = searchNotes(notes, '', { activeOnly: true });
    expect(active.map((h) => h.note.path)).toEqual(['m/Today.md']);
  });

  it('with no query returns a filtered, title-sorted list', () => {
    const all = searchNotes(notes, '', { vault: 'w' });
    expect(all.map((h) => h.note.title)).toEqual(['Agenda template', 'Communication']);
  });

  it('is case-insensitive', () => {
    expect(searchNotes(notes, 'AGENDA').length).toBeGreaterThan(0);
  });
});

describe('tokenize', () => {
  it('splits and lowercases', () => {
    expect(tokenize('  Foo   Bar ')).toEqual(['foo', 'bar']);
  });
});

describe('excerpt', () => {
  it('centers on the matched term with ellipses', () => {
    const body = 'x'.repeat(200) + ' NEEDLE ' + 'y'.repeat(200);
    const ex = excerpt(body, 'needle', 20);
    expect(ex).toContain('NEEDLE');
    expect(ex.startsWith('…')).toBe(true);
    expect(ex.endsWith('…')).toBe(true);
  });

  it('falls back to the head when no term matches', () => {
    expect(excerpt('short body here', 'zzz')).toBe('short body here');
  });
});
