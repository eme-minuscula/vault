import { describe, expect, it } from 'vitest';
import {
  isExternalSrc,
  isImagePath,
  mimeFor,
  resolveAttachmentPath,
  type ResolvableAttachment,
} from './attachments';

describe('isImagePath', () => {
  it('matches common image extensions', () => {
    expect(isImagePath('r/attachments/pic.PNG')).toBe(true);
    expect(isImagePath('a/b.jpeg')).toBe(true);
    expect(isImagePath('a/b.md')).toBe(false);
  });
});

describe('mimeFor', () => {
  it('maps extensions to mime types', () => {
    expect(mimeFor('x.png')).toBe('image/png');
    expect(mimeFor('x.jpg')).toBe('image/jpeg');
    expect(mimeFor('x.svg')).toBe('image/svg+xml');
    expect(mimeFor('x.unknown')).toBe('application/octet-stream');
  });
});

describe('isExternalSrc', () => {
  it('flags http/data/blob', () => {
    expect(isExternalSrc('https://x/y.png')).toBe(true);
    expect(isExternalSrc('data:image/png;base64,AAAA')).toBe(true);
    expect(isExternalSrc('attachments/pic.png')).toBe(false);
  });
});

const atts: ResolvableAttachment[] = [
  { path: 'r/attachments/tortilla.png', vault: 'r', filename: 'tortilla.png' },
  { path: 'w/Projects/COS/artifacts/diagram.png', vault: 'w', filename: 'diagram.png' },
  { path: 'm/attachments/tortilla.png', vault: 'm', filename: 'tortilla.png' },
];

describe('resolveAttachmentPath', () => {
  it('resolves an embed by basename within the vault', () => {
    expect(resolveAttachmentPath('tortilla.png', 'r', atts)).toBe('r/attachments/tortilla.png');
  });

  it('stays within the vault (never cross-vault)', () => {
    // tortilla.png exists in r and m; from r we get the r copy, not m.
    expect(resolveAttachmentPath('tortilla.png', 'm', atts)).toBe('m/attachments/tortilla.png');
    expect(resolveAttachmentPath('diagram.png', 'r', atts)).toBeNull();
  });

  it('resolves relative markdown srcs by path suffix', () => {
    expect(resolveAttachmentPath('attachments/diagram.png', 'w', atts)).toBe(
      'w/Projects/COS/artifacts/diagram.png',
    );
    expect(resolveAttachmentPath('./attachments/diagram.png', 'w', atts)).toBe(
      'w/Projects/COS/artifacts/diagram.png',
    );
  });

  it('handles percent-encoded names', () => {
    const enc: ResolvableAttachment[] = [
      { path: 'r/attachments/café.png', vault: 'r', filename: 'café.png' },
    ];
    expect(resolveAttachmentPath('caf%C3%A9.png', 'r', enc)).toBe('r/attachments/café.png');
  });

  it('returns null for external or missing', () => {
    expect(resolveAttachmentPath('https://x/y.png', 'r', atts)).toBeNull();
    expect(resolveAttachmentPath('nope.png', 'r', atts)).toBeNull();
  });
});
