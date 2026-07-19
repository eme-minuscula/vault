/**
 * Post-process markdown emitted by the WYSIWYG editor.
 *
 * Crepe/remark treats `[[wikilinks]]` and `![[embeds]]` as ordinary text and
 * escapes the brackets (`\[\[Name]]`), which would break the vault's links on
 * save. We restore the wiki syntax so round-tripping a note through the visual
 * editor keeps its links intact. (Other formatting may still be normalized —
 * that's the documented WYSIWYG trade-off; the raw editor stays lossless.)
 */
export function restoreVaultSyntax(md: string): string {
  return (
    md
      .replace(/\\\[\\\[/g, '[[')
      .replace(/\\\]\\\]/g, ']]')
      // Handle the mixed cases where only one side was escaped.
      .replace(/\\\[\[/g, '[[')
      .replace(/\]\\\]/g, ']]')
      // Callout markers: `> [!note]` gets escaped to `> \[!note]`.
      .replace(/\\\[!/g, '[!')
  );
}

// Obsidian-specific syntaxes that the WYSIWYG editor would silently normalize.
// When a note's body uses any of these, we open it in raw mode by default so it
// isn't mangled just by viewing + saving.
const EXTENDED_SYNTAX = [
  /^\s*>\s*\[!/m, // callouts:  > [!note]
  /==[^=\n]+==/, // highlights: ==text==
  /%%[\s\S]*?%%/, // comments:  %%…%%
  /(?:^|\s)\^[A-Za-z0-9-]+\s*$/m, // block refs: ^id at line end
];

export function hasExtendedSyntax(body: string): boolean {
  return EXTENDED_SYNTAX.some((re) => re.test(body));
}
