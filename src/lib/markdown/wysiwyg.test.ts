import { describe, expect, it } from 'vitest';
import { restoreVaultSyntax } from './wysiwyg';

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
});
