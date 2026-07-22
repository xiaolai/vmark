/**
 * Tier-1 differential test — Phase 2 WI-2.1.
 *
 * The inversion is only safe if the registry produces EXACTLY what the switch
 * produces. This builds a real ProseMirror node of each migrated type on the
 * production schema, runs it through both paths, and asserts deep equality.
 *
 * Codex called for differential migration rather than big-bang; this is that
 * gate for Tier 1. The switch in `proseMirrorToMdast.ts` stays authoritative
 * until every tier has moved.
 *
 * @module utils/markdownPipeline/pmConverters.registry.test
 */
import { describe, it, expect } from "vitest";
import type { Node as PMNode } from "@tiptap/pm/model";
import { getProductionSchema } from "@/test/productionSchema";
import * as inlineConverters from "./pmInlineConverters";
import {
  convertDefinition,
  convertFrontmatter,
  convertHorizontalRule,
  convertHtmlBlock,
  convertToc,
  type PmToMdastContext,
} from "./pmBlockConverters";
import {
  createTier1Registry,
  TIER_1_NODE_NAMES,
  type PmToMdastResult,
} from "./pmConverters.registry";

const schema = getProductionSchema();

/** Minimal context; Tier-1 converters do not consult it. */
const context = {
  convertInlineContent: () => [],
  convertNode: () => null,
} as unknown as PmToMdastContext;

/** How the existing switch dispatches each Tier-1 node. */
const SWITCH_ARMS: Record<string, (node: PMNode) => PmToMdastResult> = {
  horizontalRule: () => convertHorizontalRule(),
  frontmatter: (node) => convertFrontmatter(node),
  link_definition: (node) => convertDefinition(node),
  html_block: (node) => convertHtmlBlock(node),
  toc: () => convertToc(),
  hardBreak: () => inlineConverters.convertHardBreak(),
  image: (node) => inlineConverters.convertImage(node),
  math_inline: (node) => inlineConverters.convertMathInline(node),
  footnote_reference: (node) => inlineConverters.convertFootnoteReference(node),
};

/** Representative attributes per node type. */
const SAMPLE_ATTRS: Record<string, Record<string, unknown>> = {
  horizontalRule: {},
  frontmatter: { value: "title: Test\ntags: [a, b]" },
  link_definition: {
    identifier: "ref",
    label: "Ref",
    url: "https://example.com",
    title: "A title",
  },
  html_block: { value: "<div class=\"x\">raw</div>" },
  toc: {},
  hardBreak: {},
  image: { src: "pic.png", alt: "Alt text", title: "Title" },
  math_inline: { content: "E = mc^2" },
  footnote_reference: { label: "3" },
};

function buildNode(nodeName: string): PMNode {
  const type = schema.nodes[nodeName];
  if (type === undefined) {
    throw new Error(`Production schema has no node type \`${nodeName}\``);
  }
  return type.create(SAMPLE_ATTRS[nodeName] ?? {});
}

describe("Tier-1 registry ≡ switch (differential)", () => {
  const registry = createTier1Registry();

  it("covers every node name it claims to", () => {
    expect([...registry.knownNodeNames()].sort()).toEqual(
      [...TIER_1_NODE_NAMES].sort(),
    );
  });

  it("has a differential case for every migrated node", () => {
    // Guards against migrating a node without proving equivalence.
    for (const nodeName of TIER_1_NODE_NAMES) {
      expect(SWITCH_ARMS[nodeName], `no switch arm recorded for ${nodeName}`).toBeTypeOf(
        "function",
      );
      expect(SAMPLE_ATTRS[nodeName], `no sample attrs for ${nodeName}`).toBeDefined();
    }
  });

  for (const nodeName of TIER_1_NODE_NAMES) {
    it(`${nodeName}: registry output is identical to the switch`, () => {
      const node = buildNode(nodeName);

      const lookup = registry.resolve(nodeName, node);
      expect(lookup.ok, `registry could not resolve ${nodeName}`).toBe(true);
      if (!lookup.ok) return;

      const viaRegistry = lookup.converter.convert(node, context);
      const viaSwitch = SWITCH_ARMS[nodeName](node);

      expect(viaRegistry).toEqual(viaSwitch);
    });
  }

  it("reports an unmigrated node as unknown rather than dropping it", () => {
    const paragraph = schema.nodes.paragraph.create();
    const lookup = registry.resolve("paragraph", paragraph);
    expect(lookup.ok).toBe(false);
    if (!lookup.ok) expect(lookup.failure.code).toBe("unknown-node");
  });
});
