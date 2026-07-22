/**
 * ProseMirror to MDAST Conversion — Orchestrator
 *
 * Purpose: Converts a complete ProseMirror document (including media nodes) to an
 * MDAST tree by resolving each PM node through registry 2.
 *
 * Pipeline: PM doc → PMToMdastConverter.convertDoc() → MDAST root
 *
 * Key decisions:
 *   - Node dispatch lives in registry 2 (pmConverters.registry.ts), NOT in a
 *     switch here (ADR-015 D2). The 24-arm switch this file used to carry was
 *     deleted in Phase 2; a node type cannot be added without registering a
 *     converter, so the switch cannot grow back.
 *   - PM → MDAST needs no claim protocol: the ProseMirror node type is
 *     definitive. Attribute-level competition exists only in the reverse
 *     direction (mdast → PM), which registry 1 owns.
 *   - footnote_definition is the one node still handled here, because it is a
 *     private method rather than an extracted function. Extracting it makes
 *     convertNode pure dispatch.
 *   - Schema parameter is accepted but currently unused — reserved for future
 *     custom node detection (e.g., schema-aware type checking)
 *   - ListItem nodes at root level are filtered out (they should only appear
 *     as children of list nodes)
 *   - Wiki link alias is only serialized if it differs from the target value
 *
 * @coordinates-with mdastToProseMirror.ts — reverse direction (MDAST → PM)
 * @coordinates-with pmConverters.registry.ts — registry 2, which owns dispatch
 * @coordinates-with pmBlockConverters.ts — block node conversion functions
 * @coordinates-with pmInlineConverters.ts — inline node/mark conversion functions
 * @coordinates-with serializer.ts — next step: MDAST → markdown string
 * @module utils/markdownPipeline/proseMirrorToMdast
 */

import type { Schema, Node as PMNode } from "@tiptap/pm/model";
import type {
  Root,
  Content,
  PhrasingContent,
  BlockContent,
  Html,
} from "mdast";
import type { FootnoteDefinition, WikiLink } from "./types";
import * as inlineConverters from "./pmInlineConverters";
import type { InlineItem } from "./pmInlineConverters";
import type { PmToMdastContext, PmToMdastNode } from "./pmBlockConverters";
import { mdPipelineWarn } from "@/utils/debug";
import {
  createTier1Registry,
  tryRegistry,
  type PmTier1Registry,
} from "./pmConverters.registry";

/**
 * Convert ProseMirror document to MDAST root.
 *
 * @param schema - The ProseMirror schema (used for type checking)
 * @param doc - The ProseMirror document node
 * @returns An MDAST root node
 *
 * @example
 * const doc = editor.state.doc;
 * const mdast = proseMirrorToMdast(schema, doc);
 * const markdown = serializeMdastToMarkdown(mdast);
 */
export function proseMirrorToMdast(
  schema: Schema,
  doc: PMNode,
  options: { preserveBlankLines?: boolean } = {},
): Root {
  const converter = new PMToMdastConverter(schema, options.preserveBlankLines ?? false);
  return converter.convertDoc(doc);
}

/**
 * Internal converter class for PM to MDAST conversion.
 * Schema parameter reserved for future extension (e.g., custom node detection).
 */
class PMToMdastConverter {
  private context: PmToMdastContext;

  /** Registry 2 (ADR-015 D2). Migrated types resolve here; the rest fall through. */
  private readonly registry: PmTier1Registry = createTier1Registry();

  constructor(
    _schema: Schema,
    private preserveBlankLines: boolean = false,
  ) {
    this.context = {
      convertNode: this.convertNode.bind(this),
      convertInlineContent: this.convertInlineContent.bind(this),
    };
  }

  /**
   * Convert ProseMirror doc to MDAST root.
   *
   * When preserveBlankLines is on, a top-level block's captured
   * `blankLinesBefore` attribute is stamped onto the first resulting MDAST
   * node's `data`, where the serializer's custom `join` reads it (ADR-1a: the
   * enablement lives in the DATA, not in the statically-cached serializer).
   */
  convertDoc(doc: PMNode): Root {
    const children: Content[] = [];
    const pushRootContent = (node: PmToMdastNode) => {
      if (node.type !== "listItem") {
        children.push(node);
      }
    };

    doc.forEach((child) => {
      const converted = this.convertNode(child);
      const nodes = converted ? (Array.isArray(converted) ? converted : [converted]) : [];
      if (this.preserveBlankLines && nodes.length > 0) {
        const n = (child.attrs as { blankLinesBefore?: unknown }).blankLinesBefore;
        if (typeof n === "number") {
          const first = nodes[0] as { data?: Record<string, unknown> };
          first.data = { ...first.data, blankLinesBefore: n };
        }
      }
      nodes.forEach((node) => pushRootContent(node));
    });

    return { type: "root", children };
  }

  /**
   * Convert a single ProseMirror node to MDAST node(s).
   */
  private convertNode(node: PMNode): PmToMdastNode | PmToMdastNode[] | null {
    const typeName = node.type.name;

    const viaRegistry = tryRegistry(this.registry, typeName, node, this.context);
    if (viaRegistry.handled) return viaRegistry.result;

    // Only footnote_definition remains: it is a private method on this class
    // rather than an extracted function, so it cannot be registered yet. Every
    // other arm now lives in registry 2 (pmConverters.registry.ts).
    if (typeName === "footnote_definition") {
      return this.convertFootnoteDefinition(node);
    }

    mdPipelineWarn(`[PMToMdast] Unknown node type: ${typeName}`);
    return null;
  }

  // Inline content conversion

  /**
   * Convert inline content of a block node to MDAST phrasing content.
   *
   * Text nodes become inline items carrying their marks; groupInlineItems
   * then factors marks shared by consecutive items into single MDAST
   * wrappers, so `**a *b* c**` serializes as one strong node instead of
   * adjacent strong siblings that do not round-trip (#1102). Atom nodes
   * participate unmarked (their marks were never serialized).
   */
  private convertInlineContent(node: PMNode): PhrasingContent[] {
    const items: InlineItem[] = [];
    const pushAtom = (content: PhrasingContent) => {
      items.push({ content, marks: [] });
    };

    node.forEach((child) => {
      /* v8 ignore start -- @preserve reason: isText false-branch and remaining inline type branches are rare/defensive in test schema */
      if (child.isText) {
        items.push(...inlineConverters.textToInlineItems(child));
      } else if (child.type.name === "hardBreak") {
        pushAtom(inlineConverters.convertHardBreak());
      } else if (child.type.name === "image") {
        pushAtom(inlineConverters.convertImage(child));
      } else if (child.type.name === "math_inline") {
        pushAtom(inlineConverters.convertMathInline(child));
      } else if (child.type.name === "footnote_reference") {
        pushAtom(inlineConverters.convertFootnoteReference(child));
      } else if (child.type.name === "wikiLink") {
        pushAtom(this.convertWikiLink(child));
      } else if (child.type.name === "html_inline") {
        pushAtom(this.convertHtmlInline(child));
      } else {
        // Mirror convertNode's unknown-type warning — silent inline drops
        // are hard-to-debug content loss.
        mdPipelineWarn(`[PMToMdast] Unknown inline node type: ${child.type.name}`);
      }
      /* v8 ignore stop */
    });

    return inlineConverters.groupInlineItems(items);
  }

  // Custom node converters

  private convertFootnoteDefinition(node: PMNode): FootnoteDefinition {
    const children: BlockContent[] = [];
    node.forEach((child) => {
      const converted = this.convertNode(child);
      /* v8 ignore next -- @preserve convertNode returns null for unrecognized node types */
      if (converted) {
        if (Array.isArray(converted)) {
          children.push(...(converted as BlockContent[]));
        } else {
          children.push(converted as BlockContent);
        }
      }
    });

    return {
      type: "footnoteDefinition",
      identifier: String(node.attrs.label ?? "1"),
      label: String(node.attrs.label ?? "1"),
      children,
    };
  }

  private convertWikiLink(node: PMNode): WikiLink {
    // Extract text content as alias
    let alias: string | undefined;
    if (node.content.size > 0) {
      alias = node.textContent;
    }

    const value = String(node.attrs.value ?? "");

    // Only include alias if it differs from value
    return {
      type: "wikiLink",
      value,
      alias: alias && alias !== value ? alias : undefined,
    };
  }

  private convertHtmlInline(node: PMNode): Html {
    return { type: "html", value: String(node.attrs.value ?? "") };
  }
}
