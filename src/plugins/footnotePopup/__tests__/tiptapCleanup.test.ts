// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import {
  getReferenceLabels,
  getDefinitionInfo,
  createRenumberTransaction,
  collectFootnoteNodes,
} from "../tiptapCleanup";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { inline: true, group: "inline" },
    footnote_reference: {
      inline: true,
      group: "inline",
      atom: true,
      attrs: { label: { default: "1" } },
    },
    footnote_definition: {
      content: "paragraph+",
      group: "block",
      attrs: { label: { default: "1" } },
    },
  },
});

function createState(refs: string[], defs: string[]) {
  const children = [];
  if (refs.length > 0) {
    const inlines = refs.map((label) =>
      schema.nodes.footnote_reference.create({ label })
    );
    children.push(schema.nodes.paragraph.create(null, inlines));
  } else {
    children.push(schema.nodes.paragraph.create());
  }
  for (const label of defs) {
    children.push(
      schema.nodes.footnote_definition.create({ label }, [
        schema.nodes.paragraph.create(),
      ])
    );
  }
  return EditorState.create({ doc: schema.node("doc", null, children) });
}

describe("getReferenceLabels", () => {
  it("collects all reference labels", () => {
    const state = createState(["1", "2", "3"], []);
    expect(getReferenceLabels(state.doc)).toEqual(new Set(["1", "2", "3"]));
  });

  it("returns empty set for no refs", () => {
    const state = createState([], []);
    expect(getReferenceLabels(state.doc)).toEqual(new Set());
  });
});

describe("getDefinitionInfo", () => {
  it("collects definitions with positions", () => {
    const state = createState([], ["1", "2"]);
    const defs = getDefinitionInfo(state.doc);
    expect(defs).toHaveLength(2);
    expect(defs[0].label).toBe("1");
    expect(defs[1].label).toBe("2");
  });
});

describe("createRenumberTransaction", () => {
  it("returns null when already sequential", () => {
    const state = createState(["1", "2"], ["1", "2"]);
    const tr = createRenumberTransaction(
      state,
      schema.nodes.footnote_reference,
      schema.nodes.footnote_definition
    );
    expect(tr).toBeNull();
  });

  it("renumbers out-of-order references", () => {
    const state = createState(["2", "1"], ["1", "2"]);
    const tr = createRenumberTransaction(
      state,
      schema.nodes.footnote_reference,
      schema.nodes.footnote_definition
    );
    expect(tr).not.toBeNull();
  });

  it("returns null when no refs exist", () => {
    const state = createState([], ["1"]);
    const tr = createRenumberTransaction(
      state,
      schema.nodes.footnote_reference,
      schema.nodes.footnote_definition
    );
    expect(tr).toBeNull();
  });
});

describe("collectFootnoteNodes (single-pass)", () => {
  it("collects refs and defs in one traversal", () => {
    const state = createState(["1", "2"], ["1", "2"]);
    const spy = vi.spyOn(state.doc, "descendants");

    const result = collectFootnoteNodes(state.doc);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.refs).toHaveLength(2);
    expect(result.defs).toHaveLength(2);
    expect(result.refLabels).toEqual(new Set(["1", "2"]));
    spy.mockRestore();
  });

  it("returns empty arrays for doc with no footnotes", () => {
    const state = createState([], []);
    const result = collectFootnoteNodes(state.doc);

    expect(result.refs).toHaveLength(0);
    expect(result.defs).toHaveLength(0);
    expect(result.refLabels.size).toBe(0);
  });

  it("correctly maps labels and positions", () => {
    const state = createState(["a", "b"], ["a"]);
    const result = collectFootnoteNodes(state.doc);

    expect(result.refs[0].label).toBe("a");
    expect(result.refs[1].label).toBe("b");
    expect(result.defs[0].label).toBe("a");
    expect(result.refs[0].pos).toBeGreaterThanOrEqual(0);
    expect(result.defs[0].pos).toBeGreaterThan(result.refs[0].pos);
  });
});
