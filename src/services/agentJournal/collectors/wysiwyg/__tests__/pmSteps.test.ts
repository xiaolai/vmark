// @vitest-environment node
// WI-AL1.4 — Step geometry for the WYSIWYG ledger: every supported step class reports the ranges it touched in the after document's coordinates (a replacement its replaced span, an insertion including CJK and astral text its UTF-16 length, a deletion an empty range, a ReplaceAroundStep its whole from..to, mark steps their from..to although their map is empty, attribute and node-mark steps the one node position), an unknown step class is refused with null; mapRange keeps an insertion at either edge inside the range; mergeRanges sorts and joins overlapping and touching ranges; the range-mapping budget is declared.
import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import {
  AddMarkStep,
  AddNodeMarkStep,
  AttrStep,
  RemoveMarkStep,
  RemoveNodeMarkStep,
  Step,
  StepMap,
  StepResult,
  Transform,
} from "@tiptap/pm/transform";
import { MAX_RANGE_MAPPINGS, mapRange, mergeRanges, rangeCount, stepTouched } from "../pmSteps";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", attrs: { align: { default: null } }, marks: "_" },
    blockquote: { group: "block", content: "block+" },
    image: { group: "inline", inline: true, marks: "_" },
    text: { group: "inline" },
  },
  marks: { strong: {} },
});

const p = (text: string) => schema.node("paragraph", null, text ? [schema.text(text)] : []);
const doc = (...texts: string[]) => schema.node("doc", null, texts.map(p));
const only = (tr: Transform) => {
  expect(tr.steps).toHaveLength(1);
  return stepTouched(tr.steps[0], tr.mapping.maps[0]);
};

class OpaqueStep extends Step {
  override apply(d: Parameters<Step["apply"]>[0]) { return StepResult.ok(d); }
  override invert() { return this; }
  override map() { return this; }
  override getMap() { return StepMap.empty; }
  override toJSON() { return { stepType: "opaqueForTest" }; }
}

describe("stepTouched", () => {
  it("an insertion touches its inserted span", () => {
    expect(only(new Transform(doc("ab")).insert(2, schema.text("xy")))).toEqual([[2, 4]]);
  });

  it("CJK and astral text count UTF-16 positions, as ProseMirror does", () => {
    expect(only(new Transform(doc("ab")).insert(2, schema.text("中😀")))).toEqual([[2, 5]]);
  });

  it("a deletion touches the empty range where the text was", () => {
    expect(only(new Transform(doc("abcd")).delete(2, 4))).toEqual([[2, 2]]);
  });

  it("a replacement touches the new span", () => {
    expect(only(new Transform(doc("abcd")).replaceWith(2, 4, schema.text("XYZ")))).toEqual([[2, 5]]);
  });

  it("a ReplaceAroundStep touches its whole from..to, not only the map's edges", () => {
    const tr = new Transform(doc("ab", "cd"));
    const range = tr.doc.resolve(1).blockRange(tr.doc.resolve(7));
    tr.wrap(range!, [{ type: schema.nodes.blockquote }]);
    const touched = only(tr)!;
    expect(touched).toContainEqual([0, 10]);
    expect(rangeCount(tr.mapping.maps[0])).toBe(2);
  });

  it.each([
    ["AddMarkStep", new AddMarkStep(2, 4, schema.marks.strong.create())],
    ["RemoveMarkStep", new RemoveMarkStep(2, 4, schema.marks.strong.create())],
  ])("%s touches from..to although its map is empty", (_name, step) => {
    expect(rangeCount(step.getMap())).toBe(0);
    expect(stepTouched(step, step.getMap())).toEqual([[2, 4]]);
  });

  it.each([
    ["AttrStep", new AttrStep(0, "align", "center")],
    ["AddNodeMarkStep", new AddNodeMarkStep(0, schema.marks.strong.create())],
    ["RemoveNodeMarkStep", new RemoveNodeMarkStep(0, schema.marks.strong.create())],
  ])("%s touches the one node position", (_name, step) => {
    expect(stepTouched(step, step.getMap())).toEqual([[0, 1]]);
  });

  it("an attribute step from a real transaction is the node's position", () => {
    const tr = new Transform(doc("ab", "cd")).setNodeAttribute(4, "align", "center");
    expect(only(tr)).toEqual([[4, 5]]);
  });

  it("an unknown step class is refused with null", () => {
    expect(stepTouched(new OpaqueStep(), StepMap.empty)).toBeNull();
  });
});

describe("mapRange", () => {
  const state = EditorState.create({ schema, doc: doc("abcdef") });

  it("keeps an insertion at either edge inside the range", () => {
    const atStart = state.tr.insertText("X", 2).mapping.maps[0];
    const atEnd = state.tr.insertText("X", 4).mapping.maps[0];
    expect(mapRange([2, 4], atStart)).toEqual([2, 5]);
    expect(mapRange([2, 4], atEnd)).toEqual([2, 5]);
  });

  it("shifts a range after an edit and leaves one before it", () => {
    const map = state.tr.insertText("XY", 3).mapping.maps[0];
    expect(mapRange([5, 6], map)).toEqual([7, 8]);
    expect(mapRange([1, 2], map)).toEqual([1, 2]);
  });

  it("collapses a range whose text was deleted", () => {
    const map = state.tr.delete(2, 6).mapping.maps[0];
    expect(mapRange([3, 4], map)).toEqual([2, 2]);
  });
});

describe("mergeRanges", () => {
  it.each([
    ["nothing", [], []],
    ["one range", [[1, 2]], [[1, 2]]],
    ["unsorted disjoint ranges", [[5, 6], [1, 2]], [[1, 2], [5, 6]]],
    ["overlapping ranges", [[1, 4], [3, 6]], [[1, 6]]],
    ["touching ranges", [[1, 3], [3, 5]], [[1, 5]]],
    ["a range inside another", [[1, 9], [3, 4]], [[1, 9]]],
    ["empty ranges at one point", [[3, 3], [3, 3]], [[3, 3]]],
  ] as const)("%s", (_name, input, out) => {
    expect(mergeRanges(input)).toEqual(out);
  });

  it("does not mutate its input", () => {
    const input = [[5, 6], [1, 2]] as const;
    mergeRanges(input);
    expect(input).toEqual([[5, 6], [1, 2]]);
  });
});

it("declares the range-mapping budget", () => {
  expect(MAX_RANGE_MAPPINGS).toBe(2 ** 23);
});
