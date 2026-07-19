import { describe, expect, it } from 'vitest';
import { isExcludedPath, isMarkdown, pathMeta } from './path';

describe('pathMeta', () => {
  it('derives vault, folder and filename', () => {
    expect(pathMeta('w/People/Alice.md')).toEqual({
      vault: 'w',
      folder: 'w/People',
      filename: 'Alice',
    });
  });
  it('maps unknown top segments to "other"', () => {
    expect(pathMeta('CLAUDE.md').vault).toBe('other');
  });
});

describe('isExcludedPath', () => {
  it('excludes dot-folders (Syncthing backups, tooling)', () => {
    expect(isExcludedPath('.stversions/w/PrOps/Untitled.md')).toBe(true);
    expect(isExcludedPath('.obsidian/config')).toBe(true);
    expect(isExcludedPath('w/.trash/x.md')).toBe(true);
  });
  it('excludes Creds.md anywhere, case-insensitively', () => {
    expect(isExcludedPath('w/Projects/HA/Creds.md')).toBe(true);
    expect(isExcludedPath('.stversions/w/Projects/HA/Creds.md')).toBe(true);
    expect(isExcludedPath('m/creds.md')).toBe(true);
  });
  it('keeps normal notes', () => {
    expect(isExcludedPath('w/People/Alice.md')).toBe(false);
    expect(isExcludedPath('r/Receipes/Tortilla.md')).toBe(false);
  });
});

describe('isMarkdown', () => {
  it('matches .md case-insensitively', () => {
    expect(isMarkdown('a/b.md')).toBe(true);
    expect(isMarkdown('a/b.MD')).toBe(true);
    expect(isMarkdown('a/b.png')).toBe(false);
  });
});
