/**
 * Resolve Link and Image References — Remark Plugin
 *
 * Purpose: Converts reference-style links ([text][id]) and images (![alt][id])
 * to their inline forms using the definition table, while preserving definition
 * nodes for round-trip serialization.
 *
 * Example:
 *   Input:  [text][id] ... [id]: https://example.com "Title"
 *   Output: [text](https://example.com "Title") (as link node)
 *           Definition node preserved separately
 *
 * Key decisions:
 *   - Two-pass approach: collect definitions first, then resolve references.
 *     This handles forward references (definition after usage).
 *   - Unresolved references are left as-is (remark's default fallback renders
 *     them as literal bracket text, which is the correct CommonMark behavior)
 *   - Definition nodes are intentionally NOT removed — they serialize back to
 *     markdown as `[id]: url` lines for round-trip fidelity
 *   - The resolved link REMEMBERS its reference identity (`data.referenceId`),
 *     so the serializer re-emits `[text][id]` rather than rewriting the
 *     author's file inline. Resolution is for EDITING, not for storage.
 *
 * @coordinates-with mdastBlockConverters.ts — convertDefinition handles definition nodes
 * @coordinates-with pmBlockConverters.ts — convertDefinition serializes back to MDAST
 * @module utils/markdownPipeline/plugins/resolveReferences
 */

import type { Root, Definition, LinkReference, ImageReference, Link, Image, Content } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

interface DefinitionInfo {
  url: string;
  title: string | null;
}

/**
 * Remark plugin to resolve link and image references.
 *
 * This runs after parsing to convert reference-style links/images to their
 * resolved inline forms while preserving definition nodes.
 */
export const remarkResolveReferences: Plugin<[], Root> = function () {
  return (tree) => {
    // First pass: collect definitions
    const definitions = new Map<string, DefinitionInfo>();

    visit(tree, "definition", (node: Definition) => {
      const id = node.identifier.toLowerCase();
      // FIRST definition wins, per CommonMark: "if there are several
      // matching definitions, the first one takes precedence". Overwriting
      // meant VMark edited against a different URL than every compliant
      // renderer showed.
      if (definitions.has(id)) return;
      definitions.set(id, {
        url: node.url,
        title: node.title ?? null,
      });
    });

    // Second pass: resolve references
    visit(tree, (node, index, parent) => {
      if (!parent || index === undefined) return;

      if (node.type === "linkReference") {
        const resolved = resolveLinkReference(node as LinkReference, definitions);
        if (resolved) {
          (parent.children as Content[])[index] = resolved;
        }
      } else if (node.type === "imageReference") {
        const resolved = resolveImageReference(node as ImageReference, definitions);
        if (resolved) {
          (parent.children as Content[])[index] = resolved;
        }
      }
    });
  };
};

/**
 * Resolve a linkReference to a link node.
 * Returns null if the definition is not found (node will be kept as-is).
 */
function resolveLinkReference(
  node: LinkReference,
  definitions: Map<string, DefinitionInfo>
): Link | null {
  const id = (node.identifier || node.label || "").toLowerCase();
  const def = definitions.get(id);

  if (!def) {
    // Definition not found - in dev mode this will show a warning
    // when the linkReference falls through to default case in converter
    return null;
  }

  return {
    type: "link",
    url: def.url,
    title: def.title,
    children: node.children,
    position: node.position,
    // Remember what this was, so the serializer can put it back. Resolving is
    // for EDITING — the reference form is what the author wrote. Prefer the
    // LABEL: it is the decoded form, and the serializer re-escapes labels on
    // output. Storing the identifier (still escape-carrying: `ref\[`) got
    // escaped AGAIN into `ref\\\[`, which no longer matched its definition —
    // the bracket-escape-growth defect (CommonMark examples 194/549/550).
    data: { referenceId: node.label || node.identifier || "", referenceType: node.referenceType },
  } as Link;
}

/**
 * Resolve an imageReference to an image node.
 * Returns null if the definition is not found.
 */
function resolveImageReference(
  node: ImageReference,
  definitions: Map<string, DefinitionInfo>
): Image | null {
  const id = (node.identifier || node.label || "").toLowerCase();
  const def = definitions.get(id);

  if (!def) {
    return null;
  }

  return {
    type: "image",
    url: def.url,
    title: def.title,
    alt: node.alt ?? null,
    position: node.position,
    // Same contract as links above: resolving is for EDITING, so the node
    // remembers what the author wrote and the serializer puts it back.
    // Without this, `![alt][id]` was rewritten inline on save and its
    // definition became an orphan (lint W03 on VMark's own output).
    data: {
      referenceId: node.label || node.identifier || "",
      referenceType: node.referenceType,
    },
  } as Image;
}
