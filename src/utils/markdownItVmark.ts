import MarkdownIt from "markdown-it";

type InlineStateLike = {
  pos: number;
  posMax: number;
  src: string;
  md: { inline: { tokenize: (state: unknown) => void } };
  push: (type: string, tag: string, nesting: number) => { markup?: string };
};

function addDelimitedMark(
  md: MarkdownIt,
  opts: {
    name: string;
    marker: string;
    tag: string;
    skipDoubleMarker?: boolean;
  }
) {
  const marker = opts.marker;
  const markerLen = marker.length;
  const skipDouble = opts.skipDoubleMarker ?? false;

  md.inline.ruler.push(opts.name, (state: unknown, silent: boolean) => {
    const inlineState = state as InlineStateLike;
    const start = inlineState.pos;
    const max = inlineState.posMax;

    if (start + markerLen > max) return false;
    if (inlineState.src.slice(start, start + markerLen) !== marker) return false;

    if (skipDouble && markerLen === 1 && start + 1 < max && inlineState.src[start + 1] === marker) {
      return false;
    }

    let searchPos = start + markerLen;
    while (searchPos < max) {
      const end = inlineState.src.indexOf(marker, searchPos);
      if (end === -1 || end >= max) return false;

      if (skipDouble && markerLen === 1 && end + 1 < max && inlineState.src[end + 1] === marker) {
        searchPos = end + 2;
        continue;
      }

      if (end <= start + markerLen) return false;
      if (silent) return true;

      const tokenOpen = inlineState.push(`${opts.name}_open`, opts.tag, 1);
      tokenOpen.markup = marker;

      const oldMax = inlineState.posMax;
      inlineState.pos = start + markerLen;
      inlineState.posMax = end;
      inlineState.md.inline.tokenize(inlineState as unknown as Parameters<typeof inlineState.md.inline.tokenize>[0]);
      inlineState.posMax = oldMax;

      inlineState.pos = end + markerLen;

      const tokenClose = inlineState.push(`${opts.name}_close`, opts.tag, -1);
      tokenClose.markup = marker;
      return true;
    }

    return false;
  });
}

export function createVmarkMarkdownIt(): MarkdownIt {
  const md = new MarkdownIt("commonmark", { html: false }).enable(["strikethrough", "table"]);

  addDelimitedMark(md, { name: "highlight", marker: "==", tag: "mark" });
  addDelimitedMark(md, { name: "subscript", marker: "~", tag: "sub", skipDoubleMarker: true });
  addDelimitedMark(md, { name: "superscript", marker: "^", tag: "sup" });

  return md;
}

