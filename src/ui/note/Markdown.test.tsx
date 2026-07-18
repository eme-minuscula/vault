import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';

const resolveAlice = (t: string) => (t === 'Alice' ? 'w/People/Alice.md' : null);

describe('Markdown security', () => {
  it('strips <script> tags from note content', () => {
    const { container } = render(
      <Markdown body={'Hello\n\n<script>window.__pwned = 1</script>'} resolve={() => null} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it('strips event-handler attributes and javascript: URLs', () => {
    const { container } = render(
      <Markdown
        body={'![x](javascript:alert(1)) and <img src=x onerror="alert(1)">'}
        resolve={() => null}
      />,
    );
    const img = container.querySelector('img');
    // Any surviving img must not carry an onerror handler or a javascript: src.
    expect(img?.getAttribute('onerror')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
  });
});

describe('Markdown wikilinks', () => {
  it('renders a resolved wikilink as an internal hash link', () => {
    render(<Markdown body={'See [[Alice]].'} resolve={resolveAlice} />);
    const link = screen.getByRole('link', { name: 'Alice' });
    expect(link.getAttribute('href')).toBe('#/note/w/People/Alice.md');
  });

  it('renders an unresolved wikilink as inert broken text (not a link)', () => {
    render(<Markdown body={'See [[Ghost]].'} resolve={() => null} />);
    expect(screen.queryByRole('link', { name: 'Ghost' })).toBeNull();
    expect(screen.getByText('Ghost')).toBeInTheDocument();
  });

  it('opens external links in a new tab with noopener', () => {
    render(<Markdown body={'[site](https://example.com)'} resolve={() => null} />);
    const link = screen.getByRole('link', { name: 'site' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('does not linkify wikilink syntax inside code spans', () => {
    render(<Markdown body={'`[[NotALink]]`'} resolve={() => 'w/x.md'} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('[[NotALink]]')).toBeInTheDocument();
  });
});
