/**
 * Mark delimiter hygiene — keeping edge whitespace outside the delimiters.
 *
 * GFM/CommonMark closers must be right-flanking and openers left-flanking, so
 * `~~word ~~` is not strikethrough at all: serializing a space-edged strike
 * mark verbatim emits LITERAL tildes that survive into the author's text on
 * the next parse. remark-stringify handles this for strong/em; the gfm and
 * dialect delimiters get it here.
 *
 * Split out of `pmInlineConverters.ts` to keep it under the file-size limit.
 *
 * @coordinates-with pmInlineConverters.ts — the only caller
 * @module utils/markdownPipeline/markEdgeWhitespace
 */
import type { PhrasingContent, Text } from "mdast";

/**
 * Split edge whitespace OUT of a mark's content so it lands outside the
 * delimiters. GFM/CommonMark closers must be right-flanking (openers
 * left-flanking): `~~word ~~` is not strikethrough, so serializing a
 * space-edged strike mark verbatim emits LITERAL tildes that survive into
 * the author's text on the next parse — corruption, found by the editing
 * fuzz (WI-4.1, seed 42). remark-stringify handles this for strong/em; the
 * gfm and dialect delimiters get it here.
 */
function expelEdgeWhitespace(content: PhrasingContent[]): {
  leading: string;
  trimmed: PhrasingContent[];
  trailing: string;
} {
  const out = content.map((c) => (c.type === "text" ? { ...c } : c));
  let leading = "";
  let trailing = "";
  const first = out[0];
  if (first?.type === "text") {
    const match = /^[ \t]+/.exec(first.value);
    if (match) {
      leading = match[0];
      first.value = first.value.slice(match[0].length);
    }
  }
  const last = out[out.length - 1];
  if (last?.type === "text") {
    const match = /[ \t]+$/.exec(last.value);
    if (match) {
      trailing = match[0];
      last.value = last.value.slice(0, -match[0].length);
    }
  }
  return {
    leading,
    trimmed: out.filter((c) => c.type !== "text" || c.value.length > 0),
    trailing,
  };
}

/** Wrap `children` in `node`, re-attaching expelled edge whitespace outside. */
export function wrapExpelled(
  content: PhrasingContent[],
  make: (children: PhrasingContent[]) => PhrasingContent,
): PhrasingContent[] {
  const { leading, trimmed, trailing } = expelEdgeWhitespace(content);
  if (trimmed.length === 0) {
    // Whitespace-only content: a delimiter pair around nothing is not
    // representable — emit the whitespace alone.
    const text = leading + trailing;
    return text ? [{ type: "text", value: text } as Text] : [];
  }
  const out: PhrasingContent[] = [];
  if (leading) out.push({ type: "text", value: leading } as Text);
  out.push(make(trimmed));
  if (trailing) out.push({ type: "text", value: trailing } as Text);
  return out;
}

/**
 * Wrap content with an MDAST mark node.
 */
