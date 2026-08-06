/**
 * Purpose: serialize a `details` MDAST node back to HTML — the mdast→markdown
 * direction of `detailsBlock`.
 *
 * Split from the parser when the file crossed 300 lines. Parsing HTML into a
 * node and writing a node back out are opposite directions with no shared
 * state; keeping them together meant every change to one re-read the other.
 *
 * Key decisions:
 *   - Summary text is HTML-ESCAPED on the way out. It arrives from the
 *     document, so a `<` in it would otherwise close the tag early and let
 *     authored text become markup.
 *
 * @coordinates-with detailsBlock.ts — registers this as a toMarkdown extension
 * @module utils/markdownPipeline/plugins/detailsSerializer
 */
import type { Details } from "../types";

/** State handed to a toMarkdown handler. */
export interface DetailsHandlerState {
  enter: (type: string) => () => void;
  containerFlow: (node: unknown, info: unknown) => string;
  createTracker: (info: unknown) => {
    move: (value: string) => string;
    current: () => { before: string; after: string };
  };
}

export function detailsHandler(
  node: Details,
  _parent: unknown,
  state: DetailsHandlerState,
  info: { before: string; after: string }
): string {
  const exit = state.enter("details");
  const tracker = state.createTracker(info);
  const openAttr = node.open ? " open" : "";

  let value = tracker.move(`<details${openAttr}>`);
  value += tracker.move("\n");
  value += tracker.move(`<summary>${escapeHtml(node.summary ?? "Details")}</summary>`);
  value += tracker.move("\n\n");

  const content = state.containerFlow(node, tracker.current()).trimEnd();
  value += tracker.move(content);
  value += tracker.move("\n");
  value += tracker.move("</details>");

  exit();
  return value;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
