import { describe, expect, it } from 'vitest';
import {
  cleanFolder,
  composeNewNoteText,
  newNoteContext,
  newNoteHref,
  folderOptions,
  frontmatterBlock,
  matchExistingFolder,
  planNewNote,
  ruleFor,
  titleFallback,
  titleToFilename,
} from './newNote';

const now = new Date(2026, 9, 20, 9, 5, 7); // 2026-10-20 09:05:07 local

describe('ruleFor', () => {
  it('matches a folder and its subfolders, most specific first', () => {
    expect(ruleFor('m', 'Journaling')?.type).toBe('journal');
    expect(ruleFor('m', 'People/persones escriptores')?.type).toBe('person');
    expect(ruleFor('m', 'Travel/Logs')?.type).toBe('trip-log');
    expect(ruleFor('m', 'Travel')).toBeUndefined();
  });

  it('keeps vaults apart and has no rule for the inbox', () => {
    expect(ruleFor('w', 'Books')).toBeUndefined();
    expect(ruleFor('_inbox', '')).toBeUndefined();
  });
});

describe('folderOptions', () => {
  it('lists note folders with ancestors, plus schema folders, minus k/ and attachments', () => {
    const opts = folderOptions('m', [
      'm',
      'm/People/persones escriptores',
      'm/k/Topics',
      'm/attachments',
      'w/PrOps',
    ]);
    expect(opts).toContain('');
    expect(opts).toContain('People');
    expect(opts).toContain('People/persones escriptores');
    expect(opts).toContain('Travel/Plans'); // from the schema, no notes yet
    expect(opts).not.toContain('k');
    expect(opts).not.toContain('k/Topics');
    expect(opts).not.toContain('attachments');
    expect(opts).not.toContain('PrOps');
  });
});

describe('titleToFilename / cleanFolder', () => {
  it('strips characters that break filenames or wikilinks', () => {
    expect(titleToFilename('  Q3: plan / #ideas [draft]? ')).toBe('Q3 plan ideas draft');
    expect(titleToFilename('..hidden')).toBe('hidden');
    expect(titleToFilename('Cafè de filtre')).toBe('Cafè de filtre');
  });

  it('cleans folder segments and refuses traversal', () => {
    expect(cleanFolder('/Projects//NEW/ ')).toBe('Projects/NEW');
    expect(cleanFolder('../x')).toBe('x');
  });
});

describe('planNewNote', () => {
  it('builds the path and schema frontmatter for a typed folder', () => {
    const plan = planNewNote({
      target: 'm',
      folder: 'Journaling',
      title: 'A good day',
      active: false,
      now,
    });
    expect(plan.path).toBe('m/Journaling/A good day.md');
    expect(frontmatterBlock(plan.fields)).toBe("---\ntype: journal\ndate: '2026-10-20'\n---\n");
  });

  it('adds active only when asked, and nothing for an untyped folder', () => {
    const off = planNewNote({ target: 'w', folder: 'PrOps', title: 'Standup', active: false, now });
    expect(off.path).toBe('w/PrOps/Standup.md');
    expect(frontmatterBlock(off.fields)).toBe('');
    const on = planNewNote({ target: 'w', folder: 'PrOps', title: 'Standup', active: true, now });
    expect(frontmatterBlock(on.fields)).toBe('---\nactive: true\n---\n');
  });

  it('writes at the vault root when no folder is chosen', () => {
    expect(planNewNote({ target: 'm', folder: '', title: 'Recap', active: false, now }).path).toBe(
      'm/Recap.md',
    );
  });

  it('needs a title, except where one can be derived', () => {
    expect(planNewNote({ target: 'w', folder: 'HR', title: '  ', active: false, now }).path).toBe(
      null,
    );
    expect(
      planNewNote({ target: 'm', folder: 'DailyNotes', title: '', active: false, now }).path,
    ).toBe('m/DailyNotes/2026-10-20.md');
  });

  it('inbox captures are always active, named by timestamp when untitled', () => {
    const plan = planNewNote({
      target: '_inbox',
      folder: 'ignored',
      title: '',
      active: false,
      now,
    });
    expect(plan.path).toBe('_inbox/2026-10-20-0905-07.md');
    expect(plan.fields).toEqual([['active', 'true']]);
    expect(
      planNewNote({ target: '_inbox', folder: '', title: 'idea', active: false, now }).path,
    ).toBe('_inbox/idea.md');
  });
});

describe('titleFallback', () => {
  it('shows what an empty title becomes', () => {
    expect(titleFallback('_inbox', '', now)).toBe('2026-10-20-0905-07');
    expect(titleFallback('m', 'DailyNotes', now)).toBe('2026-10-20');
    expect(titleFallback('w', 'PrOps', now)).toBeNull();
  });
});

describe('planNewNote guards', () => {
  const base = { target: 'w' as const, active: false, now };

  it('never produces a dot-folder or dotfile', () => {
    expect(titleToFilename('. .hidden')).toBe('hidden');
    expect(cleanFolder('. .obsidian')).toBe('obsidian');
    expect(planNewNote({ ...base, folder: '. .obsidian', title: 'x' }).path).toBe(
      'w/obsidian/x.md',
    );
  });

  it('refuses Creds.md', () => {
    const plan = planNewNote({ ...base, folder: 'Projects/HA', title: 'creds' });
    expect(plan.path).toBeNull();
    expect(plan.problem).toMatch(/not allowed|isn’t allowed/);
  });

  it('refuses the wiki and attachment folders, even when typed', () => {
    expect(planNewNote({ ...base, folder: 'k/Topics', title: 'x' }).path).toBeNull();
    expect(planNewNote({ ...base, folder: 'Projects/attachments', title: 'x' }).path).toBeNull();
  });

  it('explains a missing title', () => {
    expect(planNewNote({ ...base, folder: 'HR', title: '' }).problem).toBe('Add a title.');
  });
});

describe('composeNewNoteText', () => {
  it('prepends the generated block', () => {
    expect(composeNewNoteText([['type', 'journal']], 'Hi')).toBe('---\ntype: journal\n---\n\nHi');
    expect(composeNewNoteText([], 'Hi')).toBe('Hi');
  });

  it('keeps hand-typed frontmatter, still applying Active when the plan has it', () => {
    const typed = '---\ntype: idea\n---\nHi';
    expect(composeNewNoteText([['type', 'learning']], typed)).toBe(typed);
    const activeTyped = '---\nactive: true\ntype: idea\n---\nHi';
    // Inbox capture...
    expect(composeNewNoteText([['active', 'true']], typed)).toBe(activeTyped);
    // ...and a Work note with the Active switch on.
    const plan = planNewNote({ target: 'w', folder: 'Learning', title: 'x', active: true, now });
    expect(composeNewNoteText(plan.fields, typed)).toBe(activeTyped);
  });
});

describe('newNoteHref / newNoteContext', () => {
  it('carries the vault or note folder being browsed', () => {
    expect(newNoteHref('/v/w')).toBe('/new?in=w');
    expect(newNoteHref('/note/m/People/M%C3%B2nica.md')).toBe('/new?in=m%2FPeople');
    expect(newNoteHref('/note/w/Foo.md')).toBe('/new?in=w');
    expect(newNoteHref('/note/README.md')).toBe('/new');
    expect(newNoteHref('/')).toBe('/new');
  });

  it('survives a malformed escape in a hand-typed link', () => {
    expect(newNoteHref('/note/w/100%zz.md')).toBe('/new');
  });

  it('defaults to Quick capture without a vault, and drops reserved folders', () => {
    expect(newNoteContext('')).toEqual({ target: '_inbox', folder: '' });
    expect(newNoteContext('r/x')).toEqual({ target: '_inbox', folder: '' });
    expect(newNoteContext('m/People')).toEqual({ target: 'm', folder: 'People' });
    expect(newNoteContext('w/k/Topics')).toEqual({ target: 'w', folder: '' });
  });
});

describe('case-insensitive folders', () => {
  const base = { active: false, now };

  it('reserved folders are refused in any casing', () => {
    expect(planNewNote({ ...base, target: 'w', folder: 'K', title: 'x' }).path).toBeNull();
    expect(
      planNewNote({ ...base, target: 'w', folder: 'Attachments', title: 'x' }).path,
    ).toBeNull();
  });

  it('a typed case variant reuses the existing folder and its rule', () => {
    expect(matchExistingFolder('learning/new', ['Learning', 'PrOps'])).toBe('Learning/new');
    const plan = planNewNote({
      ...base,
      target: 'm',
      folder: 'books',
      title: 'x',
      knownFolders: ['Books'],
    });
    expect(plan.path).toBe('m/Books/x.md');
    expect(plan.fields).toEqual([['type', 'book']]);
    // Even without the folder list, the rule still matches.
    expect(ruleFor('m', 'books')?.type).toBe('book');
  });

  it('date-named folders fall back to today in any casing', () => {
    expect(titleFallback('m', 'dailynotes', now)).toBe('2026-10-20');
  });
});

describe('reserved names and length', () => {
  const base = { target: 'w' as const, folder: 'Projects/X', active: false, now };

  it('refuses CLAUDE.md and CLAUDE.local.md, which Claude Code reads as instructions', () => {
    expect(planNewNote({ ...base, title: 'CLAUDE' }).path).toBeNull();
    expect(planNewNote({ ...base, title: 'claude' }).path).toBeNull();
    expect(planNewNote({ ...base, title: 'CLAUDE.local' }).path).toBeNull();
    expect(planNewNote({ ...base, title: 'Claude notes' }).path).toBe(
      'w/Projects/X/Claude notes.md',
    );
  });

  it('caps a long title at 200 UTF-8 bytes without splitting a character', () => {
    const stem = titleToFilename('à'.repeat(150)); // 300 bytes
    expect(new TextEncoder().encode(stem).length).toBe(200);
    expect(stem).toBe('à'.repeat(100));
  });
});
