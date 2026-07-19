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
  );
}
