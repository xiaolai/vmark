// @vitest-environment node
// WI-AL1.4 — The span serializer fails safe when the dependency's stringify does not behave as its recording assumes: a container flow that does not decompose into the recorded outputs and separators, root output that is neither the container nor the container plus a newline, and block outputs that arrive out of document order each yield no spans and name the reason, never wrong spans. The perturbation is applied at the third-party boundary (unified's Processor.stringify), so the code under test runs unmodified.
import { afterEach, describe, expect, it, vi } from "vitest";
import { unified } from "unified";
import type { Root } from "mdast";
import { parseMarkdown, serializeMarkdown } from "./adapter";
import { serializeWithSpans } from "./serializerSpans";
import { testSchema } from "./testSchema";

type Stringify = (this: unknown, tree: Root) => unknown;
const processorProto = Object.getPrototypeOf(unified()) as { stringify: Stringify };
const original = processorProto.stringify;

/** Route every stringify through `wrap`, which receives the real one. */
function perturbStringify(wrap: (real: (tree: Root) => unknown, tree: Root) => unknown) {
  vi.spyOn(processorProto, "stringify").mockImplementation(function (this: unknown, tree: Root) {
    return wrap((t) => original.call(this, t), tree);
  });
}

function setup(markdown: string) {
  const doc = parseMarkdown(testSchema, markdown, {});
  return { doc, reference: serializeMarkdown(testSchema, doc, {}) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("serializeWithSpans fail-safes", () => {
  it("the unperturbed seam still yields spans (the spy itself changes nothing)", () => {
    const { doc, reference } = setup("# Title\n\nbody 中文\n");
    perturbStringify((real, tree) => real(tree));
    expect(serializeWithSpans(testSchema, doc, {}, reference)).toMatchObject({ ok: true, markdown: reference });
  });

  it("a container flow recorded twice does not decompose: no spans", () => {
    const { doc, reference } = setup("a\n\nb\n");
    perturbStringify((real, tree) => {
      real(tree);
      return real(tree);
    });
    expect(serializeWithSpans(testSchema, doc, {}, reference)).toEqual({ ok: false, reason: "container-decomposition" });
  });

  it.each([
    ["trailing text", (s: string) => `${s}extra`],
    ["a second trailing newline", (s: string) => `${s}\n\n`],
    ["a dropped character", (s: string) => s.slice(1)],
  ])("root output with %s is not the container: no spans", (_name, alter) => {
    const { doc, reference } = setup("a\n\nb\n");
    perturbStringify((real, tree) => alter(String(real(tree))));
    expect(serializeWithSpans(testSchema, doc, {}, reference)).toEqual({ ok: false, reason: "root-finalization" });
  });

  it("block outputs out of document order: no spans", () => {
    const { doc, reference } = setup("first\n\nsecond\n\n😀 third\n");
    perturbStringify((real, tree) => real({ ...tree, children: [...tree.children].reverse() }));
    expect(serializeWithSpans(testSchema, doc, {}, reference)).toEqual({ ok: false, reason: "block-tags-out-of-order" });
  });
});
