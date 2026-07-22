import { describe, expect, it } from 'vitest';
import {
  buildWikiResolver,
  extractWikiLinks,
  findBacklinks,
  parseWikiTarget,
  resolveWikiTarget,
  type ResolvableNote,
} from './links';

describe('parseWikiTarget', () => {
  it('splits label and heading', () => {
    expect(parseWikiTarget('Note#Section|Nice label')).toMatchObject({
      target: 'Note',
      heading: 'Section',
      label: 'Nice label',
    });
  });
  it('handles a bare target', () => {
    expect(parseWikiTarget('Just a note')).toMatchObject({
      target: 'Just a note',
      heading: null,
      label: null,
    });
  });
});

describe('extractWikiLinks', () => {
  it('finds links and embeds', () => {
    const links = extractWikiLinks('See [[Alice]] and ![[diagram.png]] and [[b/Carol|C]].');
    expect(links.map((l) => l.target)).toEqual(['Alice', 'diagram.png', 'b/Carol']);
    expect(links[1]?.embed).toBe(true);
    expect(links[2]?.label).toBe('C');
  });
});

const notes: ResolvableNote[] = [
  { path: 'w/People/Alice.md', vault: 'w', filename: 'Alice' },
  { path: 'm/People/Alice.md', vault: 'm', filename: 'Alice' },
  { path: 'w/Projects/COS/Plan.md', vault: 'w', filename: 'Plan' },
  { path: 'w/Team/Plan.md', vault: 'w', filename: 'Plan' },
];

describe('resolveWikiTarget', () => {
  it('resolves by basename within the same vault', () => {
    expect(resolveWikiTarget('Alice', 'w', notes)).toBe('w/People/Alice.md');
  });

  it('keeps vaults isolated — never resolves across vaults', () => {
    expect(resolveWikiTarget('Alice', 'r', notes)).toBeNull();
    // From m, resolves to the m copy, not w.
    expect(resolveWikiTarget('Alice', 'm', notes)).toBe('m/People/Alice.md');
  });

  it('returns null for an ambiguous basename', () => {
    expect(resolveWikiTarget('Plan', 'w', notes)).toBeNull();
  });

  it('disambiguates with a folder path', () => {
    expect(resolveWikiTarget('Projects/COS/Plan', 'w', notes)).toBe('w/Projects/COS/Plan.md');
  });

  it('is case-insensitive and ignores a .md suffix', () => {
    expect(resolveWikiTarget('alice.md', 'w', notes)).toBe('w/People/Alice.md');
  });

  it('returns null for an unknown target', () => {
    expect(resolveWikiTarget('Nobody', 'w', notes)).toBeNull();
  });
});

describe('buildWikiResolver', () => {
  it('matches resolveWikiTarget for every case, from one built index', () => {
    const resolver = buildWikiResolver(notes);
    const cases: [string, 'w' | 'm' | 'r'][] = [
      ['Alice', 'w'],
      ['Alice', 'm'],
      ['Alice', 'r'],
      ['Plan', 'w'],
      ['Projects/COS/Plan', 'w'],
      ['alice.md', 'w'],
      ['Nobody', 'w'],
      ['', 'w'],
    ];
    for (const [target, vault] of cases) {
      expect(resolver.resolve(target, vault)).toBe(resolveWikiTarget(target, vault, notes));
    }
  });
});

describe('findBacklinks', () => {
  const corpus = [
    { path: 'w/A.md', vault: 'w' as const, filename: 'A', body: 'links to [[B]] here' },
    { path: 'w/B.md', vault: 'w' as const, filename: 'B', body: 'no links' },
    { path: 'w/C.md', vault: 'w' as const, filename: 'C', body: 'also [[B]] and [[A]]' },
    { path: 'm/D.md', vault: 'm' as const, filename: 'D', body: 'other vault [[B]]' },
  ];

  it('lists same-vault notes that link to the target', () => {
    expect(findBacklinks('w/B.md', 'w', corpus).sort()).toEqual(['w/A.md', 'w/C.md']);
  });

  it('excludes cross-vault links', () => {
    // m/D links [[B]] but resolves within m (no B there), so it is not a backlink.
    expect(findBacklinks('w/B.md', 'w', corpus)).not.toContain('m/D.md');
  });

  it('returns empty when nothing links in', () => {
    // Nothing in the corpus links to C.
    expect(findBacklinks('w/C.md', 'w', corpus)).toEqual([]);
  });
});
