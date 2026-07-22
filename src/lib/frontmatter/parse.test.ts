import { describe, expect, it } from 'vitest';
import { parseNote, stripLeadingH1 } from './parse';
import { splitDoc } from './doc';

describe('parseNote', () => {
  it('agrees with splitDoc on where frontmatter ends (one boundary definition)', () => {
    // A closing fence must be followed by a newline or EOF; `---text` is not a
    // real fence, so the whole thing is body — and parseNote must not disagree
    // with the lossless splitDoc, or a note could be indexed one way and written
    // another.
    const tricky = '---\ntype: note\n---not a fence, still body';
    expect(parseNote(tricky).rawFrontmatter).toBeNull();
    expect(parseNote(tricky).body).toBe(tricky);
    expect(splitDoc(tricky).frontmatter).toBe('');
  });

  it('parses inline tags, type, active and date', () => {
    const raw = [
      '---',
      'type: recipe',
      'tags: [dinner, quick]',
      'active: true',
      'date: 2026-05-09',
      '---',
      '',
      '# Tortilla',
      '',
      'Some body text.',
    ].join('\n');

    const p = parseNote(raw);
    expect(p.frontmatter.type).toBe('recipe');
    expect(p.frontmatter.tags).toEqual(['dinner', 'quick']);
    expect(p.frontmatter.active).toBe(true);
    expect(p.frontmatter.date).toBe('2026-05-09');
    expect(p.heading).toBe('Tortilla');
    expect(p.body.startsWith('\n# Tortilla')).toBe(true);
  });

  it('parses aliases (inline and block, and the singular key)', () => {
    expect(parseNote('---\naliases: [Al, Ally]\n---\nx').frontmatter.aliases).toEqual([
      'Al',
      'Ally',
    ]);
    expect(parseNote('---\nalias: Solo\n---\nx').frontmatter.aliases).toEqual(['Solo']);
    const block = parseNote('---\naliases:\n  - One\n  - Two\ntype: person\n---\nx').frontmatter;
    expect(block.aliases).toEqual(['One', 'Two']);
    expect(block.type).toBe('person'); // block list stops at the next key
    expect(parseNote('---\ntype: note\n---\nx').frontmatter.aliases).toEqual([]);
  });

  it('parses block-list tags', () => {
    const raw = ['---', 'tags:', '  - alpha', '  - beta', '---', 'body'].join('\n');
    const p = parseNote(raw);
    expect(p.frontmatter.tags).toEqual(['alpha', 'beta']);
  });

  it('preserves raw frontmatter verbatim for lossless editing', () => {
    const raw = ['---', 'type: person', '---', 'hello'].join('\n');
    const p = parseNote(raw);
    expect(p.rawFrontmatter).toBe('type: person');
  });

  it('treats a document with no frontmatter as pure body', () => {
    const raw = 'Just a note.\n\nWith a horizontal rule below.\n\n---\n\nmore';
    const p = parseNote(raw);
    expect(p.rawFrontmatter).toBeNull();
    expect(p.frontmatter.active).toBe(false);
    expect(p.body).toBe(raw);
  });

  it('does not treat a body horizontal rule as frontmatter', () => {
    const raw = '# Title\n\ntext\n\n---\n\nmore text';
    const p = parseNote(raw);
    expect(p.rawFrontmatter).toBeNull();
    expect(p.heading).toBe('Title');
  });

  it('handles active: false and quoted values', () => {
    const raw = ['---', 'type: "daily"', 'active: false', "date: '2026-01-01'", '---', 'x'].join(
      '\n',
    );
    const p = parseNote(raw);
    expect(p.frontmatter.type).toBe('daily');
    expect(p.frontmatter.active).toBe(false);
    expect(p.frontmatter.date).toBe('2026-01-01');
  });

  it('stripLeadingH1 removes only a leading H1, once', () => {
    expect(stripLeadingH1('# Title\n\nbody')).toBe('body');
    expect(stripLeadingH1('\n\n# Title\nmore')).toBe('more');
    // Leaves non-leading headings and H2s alone.
    expect(stripLeadingH1('intro\n\n# Later')).toBe('intro\n\n# Later');
    expect(stripLeadingH1('## Sub\n\nbody')).toBe('## Sub\n\nbody');
    // Tab after the hash is handled the same as a space.
    expect(stripLeadingH1('#\tTitle\n\nbody')).toBe('body');
  });

  it('builds a trimmed snippet from the body', () => {
    const raw = '---\ntype: note\n---\n\n# Heading\n\nFirst paragraph with **bold** text.';
    const p = parseNote(raw);
    expect(p.snippet).toContain('First paragraph with bold text');
    expect(p.snippet).not.toContain('#');
    expect(p.snippet).not.toContain('*');
  });
});
