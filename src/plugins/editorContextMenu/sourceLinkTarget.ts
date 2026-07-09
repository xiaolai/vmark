/**
 * Source link-target resolution for the editor context menu (WI-4.2).
 *
 * Purpose: the source cursor context marks `inLink` with the link's
 * source extent but leaves `href` unparsed. Copy Link needs the actual
 * target, so this module parses it from the link syntax — bounded scope:
 * inline links (`[t](url "title")`, angle-bracket targets) and reference
 * links (full `[t][label]`, collapsed `[t][]`, shortcut `[t]`) resolved
 * against the document's `[label]: url` definitions (case-insensitive).
 * Anything else returns null and Copy Link stays disabled.
 *
 * Pure string functions — table-tested without CodeMirror.
 *
 * @coordinates-with snapshot.ts — buildSourceSnapshot consumes this
 * @module plugins/editorContextMenu/sourceLinkTarget
 */

export type ParsedLinkTarget =
  | { kind: "inline"; target: string }
  | { kind: "ref"; label: string };

/** Strip `<...>` angle-bracket wrapping from a link destination. */
function unwrapTarget(raw: string): string {
  if (raw.startsWith("<") && raw.endsWith(">")) return raw.slice(1, -1);
  return raw;
}

/**
 * Parse a complete link's source syntax (as delimited by the cursor
 * context) into its target or reference label. Returns null when the
 * syntax doesn't match a supported link form or has an empty target.
 */
export function parseLinkTarget(linkSyntax: string): ParsedLinkTarget | null {
  if (!linkSyntax.startsWith("[")) return null;

  if (linkSyntax.endsWith(")")) {
    // Inline: [text](destination "title") — split at the LAST "](" so
    // nested brackets in the text don't confuse the scan.
    const sep = linkSyntax.lastIndexOf("](");
    if (sep <= 0) return null;
    const inner = linkSyntax.slice(sep + 2, -1).trim();
    if (!inner) return null;
    const rawTarget = inner.startsWith("<")
      ? inner.slice(0, inner.indexOf(">") + 1)
      : inner.split(/\s+/)[0];
    const target = unwrapTarget(rawTarget);
    return target ? { kind: "inline", target } : null;
  }

  if (linkSyntax.endsWith("]")) {
    // Reference: [text][label], collapsed [text][], or shortcut [text].
    const sep = linkSyntax.lastIndexOf("][");
    if (sep > 0) {
      const label = linkSyntax.slice(sep + 2, -1);
      const text = linkSyntax.slice(1, sep);
      const effective = label || text;
      return effective ? { kind: "ref", label: effective } : null;
    }
    const text = linkSyntax.slice(1, -1);
    if (!text || text.includes("]")) return null;
    return { kind: "ref", label: text };
  }

  return null;
}

/**
 * Resolve a reference label against the document's link definitions
 * (`[label]: destination`, up to 3 leading spaces, case-insensitive,
 * optional angle-bracket destination).
 */
export function resolveReferenceTarget(docText: string, label: string): string | null {
  const wanted = label.trim().toLowerCase();
  if (!wanted) return null;
  const definition = /^ {0,3}\[([^\]]+)\]:\s*(<[^>]*>|\S+)/gm;
  for (const match of docText.matchAll(definition)) {
    if (match[1].trim().toLowerCase() === wanted) {
      const target = unwrapTarget(match[2]);
      return target || null;
    }
  }
  return null;
}

/**
 * Full resolution: parse the link syntax; inline targets return directly,
 * reference labels resolve against the document text (fetched lazily —
 * inline links never pay the full-document read).
 */
export function getSourceLinkTarget(
  linkSyntax: string,
  getDocText: () => string
): string | null {
  const parsed = parseLinkTarget(linkSyntax);
  if (!parsed) return null;
  if (parsed.kind === "inline") return parsed.target;
  return resolveReferenceTarget(getDocText(), parsed.label);
}
