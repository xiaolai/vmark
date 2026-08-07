// @vitest-environment node
/**
 * Footnote Cleanup and Renumbering Tests
 *
 * Tests for getReferenceLabels, getDefinitionInfo,
 * createRenumberTransaction, and createCleanupAndRenumberTransaction.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import {
  collectFootnoteNodes,
  getReferenceLabels,
  getDefinitionInfo,
  createRenumberTransaction,
  createCleanupAndRenumberTransaction,
  hasRefCountDropped,
} from "./tiptapCleanup";

// Minimal schema with footnote nodes
const schema = new Schema({
  nodes: {
    doc: { content: "(block | footnote_definition)+" },
    paragraph: { group: "block", content: "inline*" },
    footnote_reference: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { label: { default: "1" } },
    },
    footnote_definition: {
      content: "block+",
      attrs: { label: { default: "1" } },
    },
    text: { group: "inline" },
  },
});

function createDoc(children: Array<ReturnType<typeof schema.node>>) {
  return schema.node("doc", null, children);
}

function p(text?: string) {
  return schema.node("paragraph", null, text ? [schema.text(text)] : []);
}

function fnRef(label: string) {
  return schema.node("footnote_reference", { label });
}

function fnDef(label: string, text?: string) {
  return schema.node("footnote_definition", { label }, [p(text ?? `Footnote ${label}`)]);
}

function pWithRef(text: string, label: string) {
  return schema.node("paragraph", null, [schema.text(text), fnRef(label)]);
}

function stateFrom(doc: ReturnType<typeof createDoc>) {
  return EditorState.create({ doc, schema });
}

describe("getReferenceLabels", () => {
  it("returns empty set for doc without footnote references", () => {
    const doc = createDoc([p("Hello world")]);
    expect(getReferenceLabels(doc)).toEqual(new Set());
  });

  it("collects all reference labels", () => {
    const doc = createDoc([
      pWithRef("Text", "1"),
      pWithRef("More", "2"),
    ]);
    expect(getReferenceLabels(doc)).toEqual(new Set(["1", "2"]));
  });

  it("deduplicates labels", () => {
    const doc = createDoc([
      pWithRef("Text", "1"),
      pWithRef("More", "1"),
    ]);
    expect(getReferenceLabels(doc)).toEqual(new Set(["1"]));
  });

  it("handles label attribute being null/undefined gracefully", () => {
    const doc = createDoc([
      schema.node("paragraph", null, [
        schema.node("footnote_reference", { label: null }),
      ]),
    ]);
    const labels = getReferenceLabels(doc);
    // null coerced to "" via String(null ?? "")
    expect(labels).toEqual(new Set([""]));
  });
});

describe("getDefinitionInfo", () => {
  it("returns empty array for doc without footnote definitions", () => {
    const doc = createDoc([p("Hello")]);
    expect(getDefinitionInfo(doc)).toEqual([]);
  });

  it("collects definition info with positions and sizes", () => {
    const doc = createDoc([
      p("Text"),
      fnDef("1"),
      fnDef("2"),
    ]);
    const defs = getDefinitionInfo(doc);
    expect(defs).toHaveLength(2);
    expect(defs[0].label).toBe("1");
    expect(defs[1].label).toBe("2");
    // Positions should be positive
    expect(defs[0].pos).toBeGreaterThan(0);
    expect(defs[1].pos).toBeGreaterThan(defs[0].pos);
    // Sizes should be positive
    expect(defs[0].size).toBeGreaterThan(0);
    expect(defs[1].size).toBeGreaterThan(0);
  });

  it("handles definition with null label attribute (line 35 nullish coalescing)", () => {
    const doc = createDoc([
      p("Text"),
      schema.node("footnote_definition", { label: null }, [p("Def content")]),
    ]);
    const defs = getDefinitionInfo(doc);
    expect(defs).toHaveLength(1);
    // null ?? "" → ""
    expect(defs[0].label).toBe("");
  });

  it("handles single definition", () => {
    const doc = createDoc([p("Text"), fnDef("5")]);
    const defs = getDefinitionInfo(doc);
    expect(defs).toHaveLength(1);
    expect(defs[0].label).toBe("5");
  });
});

describe("createRenumberTransaction", () => {
  const refType = schema.nodes.footnote_reference;
  const defType = schema.nodes.footnote_definition;

  it("returns null when there are no references", () => {
    const state = stateFrom(createDoc([p("No refs"), fnDef("1")]));
    const tr = createRenumberTransaction(state, refType, defType);
    expect(tr).toBeNull();
  });

  it("returns null when labels are already sequential", () => {
    const state = stateFrom(
      createDoc([
        pWithRef("A", "1"),
        pWithRef("B", "2"),
        fnDef("1"),
        fnDef("2"),
      ])
    );
    const tr = createRenumberTransaction(state, refType, defType);
    expect(tr).toBeNull();
  });

  it("renumbers references when labels are not sequential", () => {
    const state = stateFrom(
      createDoc([
        pWithRef("A", "2"),
        pWithRef("B", "5"),
        fnDef("2", "Def two"),
        fnDef("5", "Def five"),
      ])
    );
    const tr = createRenumberTransaction(state, refType, defType);
    expect(tr).not.toBeNull();

    // Apply and verify
    const newDoc = tr!.doc;
    const newRefLabels = getReferenceLabels(newDoc);
    expect(newRefLabels).toEqual(new Set(["1", "2"]));

    const newDefs = getDefinitionInfo(newDoc);
    expect(newDefs).toHaveLength(2);
    expect(newDefs[0].label).toBe("1");
    expect(newDefs[1].label).toBe("2");
  });

  it("preserves definition content during renumbering", () => {
    const state = stateFrom(
      createDoc([
        pWithRef("A", "3"),
        fnDef("3", "Important content"),
      ])
    );
    const tr = createRenumberTransaction(state, refType, defType);
    expect(tr).not.toBeNull();

    const newDoc = tr!.doc;
    const newDefs = getDefinitionInfo(newDoc);
    expect(newDefs).toHaveLength(1);
    expect(newDefs[0].label).toBe("1");
    // Content should be preserved
    const defNode = newDoc.nodeAt(newDefs[0].pos);
    expect(defNode?.textContent).toBe("Important content");
  });

  it("handles single reference needing renumber", () => {
    const state = stateFrom(
      createDoc([
        pWithRef("Text", "7"),
        fnDef("7", "Lucky seven"),
      ])
    );
    const tr = createRenumberTransaction(state, refType, defType);
    expect(tr).not.toBeNull();

    const newRefLabels = getReferenceLabels(tr!.doc);
    expect(newRefLabels).toEqual(new Set(["1"]));
  });
});

describe("createRenumberTransaction — additional branch coverage", () => {
  const refType = schema.nodes.footnote_reference;
  const defType = schema.nodes.footnote_definition;

  it("skips replacement when newLabel equals ref.label (line 79 false branch)", () => {
    // Refs: "2", "1" → labelMap: "2"→"1", "1"→"2"
    // Ref "1" maps to "2" (needs change), ref "2" maps to "1" (needs change)
    // Both labels change, so renumber happens. But this tests the general path.
    const state = stateFrom(
      createDoc([
        pWithRef("A", "2"),
        pWithRef("B", "1"),
        fnDef("1", "Def one"),
        fnDef("2", "Def two"),
      ])
    );
    const tr = createRenumberTransaction(state, refType, defType);
    expect(tr).not.toBeNull();
    const newRefs = getReferenceLabels(tr!.doc);
    expect(newRefs).toEqual(new Set(["1", "2"]));
  });

  it("skips ref replacement when newLabel equals ref.label for some refs (line 79 mixed branch)", () => {
    // Refs: "1", "3" → labelMap: "1"→"1", "3"→"2"
    // Ref "1" maps to "1" (same, skip), ref "3" maps to "2" (different, replace)
    // This exercises both the true and false branches of `newLabel !== ref.label`
    const state = stateFrom(
      createDoc([
        pWithRef("A", "1"),
        pWithRef("B", "3"),
        fnDef("1", "Def one"),
        fnDef("3", "Def three"),
      ])
    );
    const tr = createRenumberTransaction(state, refType, defType);
    expect(tr).not.toBeNull();
    const newRefs = getReferenceLabels(tr!.doc);
    expect(newRefs).toEqual(new Set(["1", "2"]));
    // Def content should be preserved
    const newDefs = getDefinitionInfo(tr!.doc);
    expect(newDefs).toHaveLength(2);
    const def1 = tr!.doc.nodeAt(newDefs[0].pos);
    expect(def1?.textContent).toBe("Def one");
    const def2 = tr!.doc.nodeAt(newDefs[1].pos);
    expect(def2?.textContent).toBe("Def three");
  });

  it("creates empty paragraph when oldDef is not found (line 118 else branch)", () => {
    // Ref "5" exists but no definition with label "5"
    const state = stateFrom(
      createDoc([
        pWithRef("Text", "5"),
      ])
    );
    const tr = createRenumberTransaction(state, refType, defType);
    expect(tr).not.toBeNull();
    const newDefs = getDefinitionInfo(tr!.doc);
    expect(newDefs).toHaveLength(1);
    expect(newDefs[0].label).toBe("1");
    // Definition should have an empty paragraph since no content existed
    const defNode = tr!.doc.nodeAt(newDefs[0].pos);
    expect(defNode?.textContent).toBe("");
  });

  it("handles ref with null label in createRenumberTransaction (line 48 nullish coalescing)", () => {
    // Create a ref with null label — it gets coerced to ""
    const doc = createDoc([
      schema.node("paragraph", null, [
        schema.text("Text"),
        schema.node("footnote_reference", { label: null }),
      ]),
      fnDef("", "Def for empty label"),
    ]);
    const state = stateFrom(doc);
    const tr = createRenumberTransaction(state, refType, defType);
    // Label "" maps to "1" — needs renumber
    expect(tr).not.toBeNull();
  });

  it("handles duplicate ref labels — labelMap only stores first mapping (line 61 has guard)", () => {
    // Two refs with label "3" — only one entry in labelMap
    const state = stateFrom(
      createDoc([
        pWithRef("A", "3"),
        pWithRef("B", "3"),
        fnDef("3", "Shared def"),
      ])
    );
    const tr = createRenumberTransaction(state, refType, defType);
    expect(tr).not.toBeNull();
    const newDefs = getDefinitionInfo(tr!.doc);
    expect(newDefs).toHaveLength(1);
    expect(newDefs[0].label).toBe("1");
  });
});

describe("duplicate references — refs and defs share one numbering (PL-1)", () => {
  const refType = schema.nodes.footnote_reference;
  const defType = schema.nodes.footnote_definition;

  /** Assert the fixpoint invariant: every ref has a def and every def has a ref. */
  function expectNoDanglingOrOrphaned(doc: ReturnType<typeof createDoc>) {
    const { refLabels, defs } = collectFootnoteNodes(doc);
    const defLabels = new Set(defs.map((d) => d.label));
    for (const label of refLabels) {
      expect(defLabels.has(label)).toBe(true);
    }
    for (const label of defLabels) {
      expect(refLabels.has(label)).toBe(true);
    }
  }

  it("returns null for [^1][^1][^2] with defs 1,2 — already consistently numbered", () => {
    const state = stateFrom(
      createDoc([
        pWithRef("A", "1"),
        pWithRef("B", "1"),
        pWithRef("C", "2"),
        fnDef("1", "Def one"),
        fnDef("2", "Def two"),
      ])
    );
    expect(createRenumberTransaction(state, refType, defType)).toBeNull();
  });

  it("renumbers duplicate refs by distinct-label order so refs and defs agree", () => {
    const state = stateFrom(
      createDoc([
        pWithRef("A", "2"),
        pWithRef("B", "2"),
        pWithRef("C", "5"),
        fnDef("2", "Def two"),
        fnDef("5", "Def five"),
      ])
    );
    const tr = createRenumberTransaction(state, refType, defType);
    expect(tr).not.toBeNull();

    const newDoc = tr!.doc;
    const { refs, defs } = collectFootnoteNodes(newDoc);
    expect(refs.map((r) => r.label)).toEqual(["1", "1", "2"]);
    expect(defs.map((d) => d.label)).toEqual(["1", "2"]);
    expectNoDanglingOrOrphaned(newDoc);

    // Definition content preserved
    expect(newDoc.nodeAt(defs[0].pos)?.textContent).toBe("Def two");
    expect(newDoc.nodeAt(defs[1].pos)?.textContent).toBe("Def five");
  });

  it("cleanup path keeps duplicate refs and defs aligned after a deletion", () => {
    // Ref "1" was deleted; remaining refs are [^2][^2][^5], defs 1 (orphan), 2, 5
    const state = stateFrom(
      createDoc([
        pWithRef("A", "2"),
        pWithRef("B", "2"),
        pWithRef("C", "5"),
        fnDef("1", "Orphan"),
        fnDef("2", "Def two"),
        fnDef("5", "Def five"),
      ])
    );
    const tr = createCleanupAndRenumberTransaction(
      state,
      new Set(["2", "5"]),
      refType,
      defType
    );
    expect(tr).not.toBeNull();

    const newDoc = tr!.doc;
    const { refs, defs } = collectFootnoteNodes(newDoc);
    expect(refs.map((r) => r.label)).toEqual(["1", "1", "2"]);
    expect(defs.map((d) => d.label)).toEqual(["1", "2"]);
    expectNoDanglingOrOrphaned(newDoc);

    // Kept definitions preserve content; the orphan is gone
    expect(newDoc.nodeAt(defs[0].pos)?.textContent).toBe("Def two");
    expect(newDoc.nodeAt(defs[1].pos)?.textContent).toBe("Def five");
    expect(newDoc.textContent).not.toContain("Orphan");
  });

  it("renumber result is a fixpoint — a second pass finds nothing to change", () => {
    const state = stateFrom(
      createDoc([
        pWithRef("A", "3"),
        pWithRef("B", "3"),
        pWithRef("C", "7"),
        fnDef("3", "Def three"),
        fnDef("7", "Def seven"),
      ])
    );
    const tr = createRenumberTransaction(state, refType, defType);
    expect(tr).not.toBeNull();

    // Re-run on the resulting doc: nothing should need renumbering, and the
    // orphan filter (appendTransaction in tiptap.ts) must find no orphans —
    // otherwise the next pass would delete definition content.
    const nextState = stateFrom(tr!.doc as ReturnType<typeof createDoc>);
    expect(createRenumberTransaction(nextState, refType, defType)).toBeNull();
    expectNoDanglingOrOrphaned(nextState.doc);
  });
});

describe("createCleanupAndRenumberTransaction", () => {
  const refType = schema.nodes.footnote_reference;
  const defType = schema.nodes.footnote_definition;

  it("removes orphaned definitions and renumbers remaining", () => {
    // Simulate: ref "1" was deleted, only ref "2" remains
    const state = stateFrom(
      createDoc([
        pWithRef("A", "2"),
        fnDef("1", "Orphan"),
        fnDef("2", "Kept"),
      ])
    );
    const remainingRefLabels = new Set(["2"]);
    const tr = createCleanupAndRenumberTransaction(state, remainingRefLabels, refType, defType);
    expect(tr).not.toBeNull();

    const newDoc = tr!.doc;
    const newDefs = getDefinitionInfo(newDoc);
    // Only the kept definition should remain, renumbered to "1"
    expect(newDefs).toHaveLength(1);
    expect(newDefs[0].label).toBe("1");
    const defNode = newDoc.nodeAt(newDefs[0].pos);
    expect(defNode?.textContent).toBe("Kept");
  });

  it("handles multiple remaining references after deletion", () => {
    const state = stateFrom(
      createDoc([
        pWithRef("A", "1"),
        pWithRef("B", "3"),
        fnDef("1", "First"),
        fnDef("2", "Deleted ref"),
        fnDef("3", "Third"),
      ])
    );
    const remainingRefLabels = new Set(["1", "3"]);
    const tr = createCleanupAndRenumberTransaction(state, remainingRefLabels, refType, defType);
    expect(tr).not.toBeNull();

    const newDoc = tr!.doc;
    const newRefLabels = getReferenceLabels(newDoc);
    expect(newRefLabels).toEqual(new Set(["1", "2"]));

    const newDefs = getDefinitionInfo(newDoc);
    expect(newDefs).toHaveLength(2);
    expect(newDefs[0].label).toBe("1");
    expect(newDefs[1].label).toBe("2");
  });

  it("creates empty paragraph for definitions without matching content", () => {
    const state = stateFrom(
      createDoc([
        pWithRef("A", "5"),
        // No definition for "5" in remainingRefLabels set
        fnDef("3", "Orphan"),
      ])
    );
    const remainingRefLabels = new Set(["5"]);
    const tr = createCleanupAndRenumberTransaction(state, remainingRefLabels, refType, defType);
    expect(tr).not.toBeNull();

    const newDoc = tr!.doc;
    const newDefs = getDefinitionInfo(newDoc);
    expect(newDefs).toHaveLength(1);
    expect(newDefs[0].label).toBe("1");
  });

  it("creates empty paragraph fallback when def label not in remaining set (line 199 else)", () => {
    // Reference "q" exists, but its label is NOT in remainingRefLabels → defContentByLabel has no entry
    // The oldDef ternary at line 199 takes the false branch
    const state = stateFrom(
      createDoc([
        pWithRef("Text ", "q"),
        fnDef("q", "will not be retained"),
      ])
    );
    // "q" is not in remaining → its content won't be in defContentByLabel
    const remainingRefLabels = new Set<string>();
    const tr = createCleanupAndRenumberTransaction(state, remainingRefLabels, refType, defType);
    expect(tr).not.toBeNull();
    // The ref still exists in doc → gets renumbered to "1" with empty paragraph content
    const newDefs = getDefinitionInfo(tr!.doc);
    expect(newDefs).toHaveLength(1);
    expect(newDefs[0].label).toBe("1");
  });

  it("skips renumber when new label equals old label (line 168 false branch)", () => {
    // Single ref with label "1" — labelMap maps "1" → "1", so no replacement needed
    const state = stateFrom(
      createDoc([
        pWithRef("Text ", "1"),
        fnDef("1", "stays same"),
      ])
    );
    const remainingRefLabels = new Set(["1"]);
    const tr = createCleanupAndRenumberTransaction(state, remainingRefLabels, refType, defType);
    expect(tr).not.toBeNull();
    const refs = getReferenceLabels(tr!.doc);
    expect(refs.has("1")).toBe(true);
  });

  it("deduplicates labels in orderedLabels (line 184 seenLabels guard)", () => {
    // Two refs with same label "a" — the second should not add duplicate to orderedLabels
    const state = stateFrom(
      createDoc([
        pWithRef("First ", "a"),
        pWithRef("Second ", "a"),
        fnDef("a", "shared"),
      ])
    );
    const remainingRefLabels = new Set(["a"]);
    const tr = createCleanupAndRenumberTransaction(state, remainingRefLabels, refType, defType);
    expect(tr).not.toBeNull();
    const newDefs = getDefinitionInfo(tr!.doc);
    // Only one definition should be created (deduped)
    expect(newDefs).toHaveLength(1);
  });

  it("preserves content for definitions whose labels are in remainingRefLabels (line 157 node truthy)", () => {
    // Ensure the defContentByLabel branch where node IS found is covered
    const state = stateFrom(
      createDoc([
        pWithRef("A", "x"),
        pWithRef("B", "y"),
        fnDef("x", "Content X"),
        fnDef("y", "Content Y"),
      ])
    );
    const remainingRefLabels = new Set(["x", "y"]);
    const tr = createCleanupAndRenumberTransaction(state, remainingRefLabels, refType, defType);
    expect(tr).not.toBeNull();
    const newDefs = getDefinitionInfo(tr!.doc);
    expect(newDefs).toHaveLength(2);
    // Content should be preserved from original definitions
    const def1 = tr!.doc.nodeAt(newDefs[0].pos);
    expect(def1?.textContent).toBe("Content X");
    const def2 = tr!.doc.nodeAt(newDefs[1].pos);
    expect(def2?.textContent).toBe("Content Y");
  });

  it("handles ref with null label in createCleanupAndRenumberTransaction (line 138 nullish coalescing)", () => {
    const doc = createDoc([
      schema.node("paragraph", null, [
        schema.text("Text"),
        schema.node("footnote_reference", { label: null }),
      ]),
    ]);
    const state = stateFrom(doc);
    const remainingRefLabels = new Set([""]);
    const tr = createCleanupAndRenumberTransaction(state, remainingRefLabels, refType, defType);
    expect(tr).not.toBeNull();
    // Label "" gets renumbered to "1"
    const newRefs = getReferenceLabels(tr!.doc);
    expect(newRefs.has("1")).toBe(true);
  });

  it("handles empty remaining refs — removes all definitions", () => {
    const state = stateFrom(
      createDoc([
        p("No refs anymore"),
        fnDef("1", "Orphan one"),
        fnDef("2", "Orphan two"),
      ])
    );
    const remainingRefLabels = new Set<string>();
    const tr = createCleanupAndRenumberTransaction(state, remainingRefLabels, refType, defType);
    expect(tr).not.toBeNull();

    const newDoc = tr!.doc;
    const newDefs = getDefinitionInfo(newDoc);
    // No refs means no definitions should be re-created
    expect(newDefs).toHaveLength(0);
  });
});

describe("hasRefCountDropped", () => {
  const refs = (labels: string[]) => labels.map((label) => ({ label }));

  it.each([
    { old: ["1", "2"], next: ["1"], expected: true, name: "a label disappears entirely" },
    { old: ["1", "2", "1"], next: ["2", "1"], expected: true, name: "one of two duplicate refs is deleted" },
    { old: ["1", "2"], next: ["1", "2"], expected: false, name: "nothing changes" },
    { old: ["1", "2"], next: ["1", "2", "1"], expected: false, name: "a duplicate ref is added" },
    { old: [], next: [], expected: false, name: "both empty" },
    { old: [], next: ["1"], expected: false, name: "ref added to empty doc" },
    { old: ["1"], next: [], expected: true, name: "last ref deleted" },
    { old: ["1", "1", "1"], next: ["1", "1"], expected: true, name: "one of three duplicates deleted" },
    { old: ["1", "2"], next: ["2", "1"], expected: false, name: "refs reordered only" },
  ])("returns $expected when $name", ({ old, next, expected }) => {
    expect(hasRefCountDropped(refs(old), refs(next))).toBe(expected);
  });
});
