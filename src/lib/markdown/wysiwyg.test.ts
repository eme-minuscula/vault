import { describe, expect, it } from 'vitest';
import { hasExtendedSyntax, restoreVaultSyntax } from './wysiwyg';

describe('restoreVaultSyntax', () => {
  it('un-escapes fully-escaped wikilinks', () => {
    expect(restoreVaultSyntax('See \\[\\[Wes Kao\\]\\] here')).toBe('See [[Wes Kao]] here');
  });

  it('un-escapes the common open-escaped form Crepe emits', () => {
    expect(restoreVaultSyntax('See \\[\\[Wes Kao]] here')).toBe('See [[Wes Kao]] here');
  });

  it('restores embeds', () => {
    expect(restoreVaultSyntax('![\\[\\[diagram.png]]')).toContain('[[diagram.png]]');
  });

  it('leaves ordinary text untouched', () => {
    expect(restoreVaultSyntax('a normal [link](http://x) and text')).toBe(
      'a normal [link](http://x) and text',
    );
  });

  it('leaves already-correct wikilinks untouched', () => {
    expect(restoreVaultSyntax('[[Alice]] and [[Bob|B]]')).toBe('[[Alice]] and [[Bob|B]]');
  });

  it('restores an escaped callout marker', () => {
    expect(restoreVaultSyntax('> \\[!note] Heads up')).toBe('> [!note] Heads up');
  });
});

describe('hasExtendedSyntax', () => {
  it('detects callouts, highlights, comments and block refs', () => {
    expect(hasExtendedSyntax('> [!warning] be careful')).toBe(true);
    expect(hasExtendedSyntax('some ==highlighted== text')).toBe(true);
    expect(hasExtendedSyntax('a %%hidden comment%% here')).toBe(true);
    expect(hasExtendedSyntax('a paragraph ^block-1')).toBe(true);
  });

  it('returns false for ordinary markdown', () => {
    expect(hasExtendedSyntax('# Title\n\n- a\n- b\n\n**bold** and [[wikilink]]')).toBe(false);
  });
});
