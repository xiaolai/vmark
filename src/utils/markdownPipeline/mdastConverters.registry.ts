/**
 * Registry 2, mdast → ProseMirror direction — Phase 2.
 *
 * Purpose: replace the 34-arm `switch (node.type)` in `mdastToProseMirror.ts`
 * with a contributed table, mirroring what `pmConverters.registry.ts` did for
 * the reverse direction.
 *
 * Finding worth recording: the plan expected this direction to need the claim
 * protocol, because media, alerts and embeds compete for the same mdast types.
 * They do — but **not in the dispatch**. Every arm here is keyed on a distinct
 * `node.type`; the fan-out (a `paragraph` becoming `block_image`/`block_video`/
 * `block_audio`, an `html` becoming any of four things) happens *inside*
 * `convertParagraph` (mdastParagraphConverter.ts) and `convertHtml`
 * (mdastMediaConverters.ts). So this
 * migration is mechanical, and the claim protocol is needed one level deeper,
 * to decompose those two converters. That is a separate, later step.
 *
 * Converters receive one argument object rather than a positional list: this
 * direction needs the node, the active marks, block-vs-inline context, the
 * schema, the shared conversion context, and an inline-children helper. A
 * six-parameter signature per entry would be unreadable and easy to misorder.
 *
 * @coordinates-with lib/extensions/pmConverterRegistry.ts — the dispatch table
 * @coordinates-with mdastToProseMirror.ts — the switch this replaces
 * @module utils/markdownPipeline/mdastConverters.registry
 */
import type { Node as PMNode, Schema, Mark } from "@tiptap/pm/model";
import type { Content } from "mdast";
import { PmConverterRegistry } from "@/lib/extensions/pmConverterRegistry";
import { mdPipelineWarn } from "@/utils/debug";
import * as inlineConverters from "./mdastInlineConverters";
import * as blockConverters from "./mdastBlockConverters";
import * as containerConverters from "./mdastContainerConverters";
import * as mediaConverters from "./mdastMediaConverters";
import { convertParagraph } from "./mdastParagraphConverter";
import type { MdastToPmContext } from "./mdastConverterHelpers";

/** Everything an mdast → PM converter may need. */
export interface MdastConvertArgs {
  node: Content;
  marks: Mark[];
  /** Whether the node is being converted in block or inline position. */
  position: "block" | "inline";
  schema: Schema;
  ctx: MdastToPmContext;
  convertInlineChildren: (children: readonly Content[], nextMarks: Mark[]) => PMNode[];
}

export type MdastToPmResult = PMNode | PMNode[] | null;

/** Registry type for this direction. */
export type MdastRegistry = PmConverterRegistry<
  MdastConvertArgs,
  undefined,
  MdastToPmResult
>;

/* eslint-disable @typescript-eslint/no-explicit-any -- mdast's Content union does
   not narrow through a table lookup; each converter re-asserts its own node type,
   exactly as the switch's `node as Heading` casts did. */
type A = MdastConvertArgs;

/** `[mdastType, extensionId, convert]` for every migrated arm. */
const ENTRIES: ReadonlyArray<[string, string, (a: A) => MdastToPmResult]> = [
  // ---- blocks ----
  ["paragraph", "vmark.paragraph", (a) => convertParagraph(a.ctx, a.node as any, a.marks)],
  ["heading", "vmark.heading", (a) => blockConverters.convertHeading(a.ctx, a.node as any, a.marks)],
  ["code", "vmark.codeBlock", (a) => blockConverters.convertCode(a.ctx, a.node as any)],
  ["blockquote", "vmark.blockquote", (a) => containerConverters.convertBlockquote(a.ctx, a.node as any, a.marks)],
  ["list", "vmark.list", (a) => blockConverters.convertList(a.ctx, a.node as any, a.marks)],
  ["listItem", "vmark.listItem", (a) => blockConverters.convertListItem(a.ctx, a.node as any, a.marks)],
  ["thematicBreak", "vmark.horizontalRule", (a) => blockConverters.convertThematicBreak(a.ctx, a.node as any)],
  ["table", "vmark.tableUI", (a) => blockConverters.convertTable(a.ctx, a.node as any, a.marks)],
  ["math", "vmark.latex.mathBlock", (a) => blockConverters.convertMathBlock(a.ctx, a.node as any)],
  ["definition", "vmark.markdownArtifacts.linkDefinition", (a) => blockConverters.convertDefinition(a.ctx, a.node as any)],
  ["toc", "vmark.tableOfContents", (a) => blockConverters.convertToc(a.ctx, a.node as any)],
  ["details", "vmark.detailsBlock", (a) => containerConverters.convertDetails(a.ctx, a.node as any, a.marks)],
  ["footnoteDefinition", "vmark.footnotePopup.definition", (a) => blockConverters.convertFootnoteDefinition(a.ctx, a.node as any, a.marks)],
  ["wikiLink", "vmark.markdownArtifacts.wikiLink", (a) => blockConverters.convertWikiLink(a.ctx, a.node as any)],
  ["alert", "vmark.alertBlock", (a) => containerConverters.convertAlert(a.ctx, a.node as any, a.marks)],
  ["yaml", "vmark.markdownArtifacts.frontmatter", (a) => blockConverters.convertFrontmatter(a.ctx, a.node as any)],
  ["html", "vmark.markdownArtifacts.html", (a) => mediaConverters.convertHtml(a.ctx, a.node as any, a.position === "inline")],

  // ---- inline ----
  ["text", "vmark.text", (a) => inlineConverters.convertText(a.schema, a.node as any, a.marks)],
  ["strong", "vmark.bold", (a) => inlineConverters.convertStrong(a.schema, a.node as any, a.marks, a.convertInlineChildren)],
  ["emphasis", "vmark.italic", (a) => inlineConverters.convertEmphasis(a.schema, a.node as any, a.marks, a.convertInlineChildren)],
  ["delete", "vmark.strike", (a) => inlineConverters.convertDelete(a.schema, a.node as any, a.marks, a.convertInlineChildren)],
  ["inlineCode", "vmark.code", (a) => inlineConverters.convertInlineCode(a.schema, a.node as any, a.marks)],
  ["link", "vmark.link", (a) => inlineConverters.convertLink(a.schema, a.node as any, a.marks, a.convertInlineChildren)],
  ["image", "vmark.imageView", (a) => inlineConverters.convertImage(a.schema, a.node as any)],
  ["break", "vmark.hardBreak", (a) => inlineConverters.convertBreak(a.schema)],
  ["subscript", "vmark.subSuperscript.sub", (a) => inlineConverters.convertSubscript(a.schema, a.node as any, a.marks, a.convertInlineChildren)],
  ["superscript", "vmark.subSuperscript.super", (a) => inlineConverters.convertSuperscript(a.schema, a.node as any, a.marks, a.convertInlineChildren)],
  ["highlight", "vmark.highlight", (a) => inlineConverters.convertHighlight(a.schema, a.node as any, a.marks, a.convertInlineChildren)],
  ["underline", "vmark.underline", (a) => inlineConverters.convertUnderline(a.schema, a.node as any, a.marks, a.convertInlineChildren)],
  ["inlineMath", "vmark.latex.mathInline", (a) => inlineConverters.convertInlineMath(a.schema, a.node as any)],
  ["footnoteReference", "vmark.footnotePopup.reference", (a) => inlineConverters.convertFootnoteReference(a.schema, a.node as any)],
];
/* eslint-enable @typescript-eslint/no-explicit-any */

/** mdast types this registry owns. */
export const MDAST_NODE_TYPES: readonly string[] = ENTRIES.map(([type]) => type);

/** Build the mdast → PM registry. Fresh instance per call. */
export function createMdastRegistry(): MdastRegistry {
  const registry: MdastRegistry = new PmConverterRegistry();
  registry.registerAll(
    ENTRIES.map(([nodeName, extensionId, convert]) => ({
      extensionId,
      nodeName,
      convert: (args: MdastConvertArgs) => convert(args),
    })),
  );
  return registry;
}

/**
 * Consult the registry for one mdast node.
 *
 * Returns `{ handled: false }` for a type no converter claims. Dispatch is now
 * total (the legacy switch is gone) — the caller warns and yields nothing rather
 * than falling through; an ambiguous match is reported and yields nothing,
 * because ordering must not decide ownership.
 */
export function tryMdastRegistry(
  registry: MdastRegistry,
  args: MdastConvertArgs,
): { handled: true; result: MdastToPmResult } | { handled: false } {
  // The dispatch key is derived from the node itself, so a caller cannot route
  // a node through a converter for a different type.
  const nodeType = args.node.type;
  const lookup = registry.resolve(nodeType, args);
  if (lookup.ok) {
    return { handled: true, result: lookup.converter.convert(args, undefined) };
  }
  if (lookup.failure.code === "ambiguous-match") {
    mdPipelineWarn(`[MdastToPM] ${lookup.failure.message}`);
    return { handled: true, result: null };
  }
  return { handled: false };
}
