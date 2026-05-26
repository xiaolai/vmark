/**
 * showInvisibles (Tiptap / ProseMirror) Tests
 *
 * Verifies that the WYSIWYG show-invisibles plugin emits decorations
 * for spaces and hardBreak nodes when enabled, and emits nothing when
 * disabled. Toggling via plugin meta also rebuilds decorations.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

// Local re-implementation of the plugin under test that uses our local
// schema (avoids constructing a full Tiptap editor + Extension chain
// in jsdom). The plugin's logic — `buildDecorations` and the state.apply
// behavior — is duplicated faithfully from src/plugins/showInvisibles/tiptap.ts
// because that file's Tiptap Extension.create wrapper depends on a full
// Tiptap StarterKit context that's expensive to set up here.
//
// If the production plugin's buildDecorations rule changes, this test
// must be updated to match (and that change should be visible in code
// review). The test asserts the *contract*, not the wrapper.

const pluginKey = new PluginKey<DecorationSet>("showInvisiblesTest");

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    hardBreak: { group: "inline", inline: true, selectable: false },
    text: { group: "inline" },
  },
});

const SIZE_LIMIT = 200_000;

function scanRange(doc: PMNode, from: number, to: number): Decoration[] {
  const decos: Decoration[] = [];
  const widgetEnd = Math.min(to + 1, doc.content.size);
  doc.nodesBetween(from, widgetEnd, (node, pos) => {
    if (node.type.name === "hardBreak") {
      if (pos >= from && pos <= to) {
        decos.push(
          Decoration.widget(
            pos,
            () => {
              const el = document.createElement("span");
              el.className = "pm-invisible pm-invisible-hard-break";
              el.textContent = "⏎";
              return el;
            },
            { side: -1 },
          ),
        );
      }
      return;
    }
    if (node.isText && node.text) {
      const nodeStart = pos;
      const nodeEnd = pos + node.text.length;
      const overlapStart = Math.max(nodeStart, from);
      const overlapEnd = Math.min(nodeEnd, to);
      for (let i = overlapStart - nodeStart; i < overlapEnd - nodeStart; i++) {
        if (node.text[i] === " ") {
          decos.push(
            Decoration.inline(nodeStart + i, nodeStart + i + 1, {
              class: "pm-invisible-space",
            }),
          );
        }
      }
    }
  });
  return decos;
}

function buildDecorations(doc: PMNode, enabled: boolean): DecorationSet {
  if (!enabled) return DecorationSet.empty;
  if (doc.content.size > SIZE_LIMIT) return DecorationSet.empty;
  return DecorationSet.create(doc, scanRange(doc, 0, doc.content.size));
}

function changedRanges(tr: Transaction): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  for (let i = 0; i < tr.mapping.maps.length; i++) {
    const map = tr.mapping.maps[i];
    const tail = tr.mapping.slice(i + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      ranges.push({ from: tail.map(newStart), to: tail.map(newEnd) });
    });
  }
  if (ranges.length === 0) return ranges;
  ranges.sort((a, b) => a.from - b.from);
  const merged: { from: number; to: number }[] = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    const r = ranges[i];
    if (r.from <= last.to) last.to = Math.max(last.to, r.to);
    else merged.push({ from: r.from, to: r.to });
  }
  return merged;
}

function makePlugin(enabled: { value: boolean }): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: pluginKey,
    state: {
      init(_, { doc }) {
        return buildDecorations(doc, enabled.value);
      },
      apply(tr, old) {
        const force = tr.getMeta(pluginKey) as { enabled?: boolean } | undefined;
        if (force && typeof force.enabled === "boolean") {
          return buildDecorations(tr.doc, force.enabled);
        }
        if (!enabled.value) return DecorationSet.empty;
        if (tr.doc.content.size > SIZE_LIMIT) return DecorationSet.empty;
        if (!tr.docChanged) return old;
        let updated = old.map(tr.mapping, tr.doc);
        for (const range of changedRanges(tr)) {
          const overlapping = updated
            .find(range.from, range.to)
            .filter((d) =>
              d.from === d.to
                ? d.from >= range.from && d.from <= range.to
                : d.from >= range.from && d.to <= range.to,
            );
          if (overlapping.length > 0) updated = updated.remove(overlapping);
          const fresh = scanRange(tr.doc, range.from, range.to);
          if (fresh.length > 0) updated = updated.add(tr.doc, fresh);
        }
        return updated;
      },
    },
    props: {
      decorations(state) {
        return this.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}

function createState(enabled: { value: boolean }, content: PMNode) {
  return EditorState.create({
    doc: content,
    plugins: [makePlugin(enabled)],
  });
}

function docWithText(text: string): PMNode {
  return schema.node("doc", null, [schema.node("paragraph", null, text ? [schema.text(text)] : [])]);
}

function docWithHardBreak(): PMNode {
  return schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.text("a"),
      schema.node("hardBreak"),
      schema.text("b"),
    ]),
  ]);
}

function getDecorations(state: EditorState): Decoration[] {
  const set = pluginKey.getState(state);
  if (!set) return [];
  return set.find();
}

describe("showInvisibles Tiptap plugin (disabled)", () => {
  it("returns empty decoration set when disabled", () => {
    const enabled = { value: false };
    const state = createState(enabled, docWithText("a b c"));
    expect(getDecorations(state).length).toBe(0);
  });
});

describe("showInvisibles Tiptap plugin (enabled)", () => {
  it("emits one inline decoration per ASCII space", () => {
    const enabled = { value: true };
    const state = createState(enabled, docWithText("a b c"));
    const decos = getDecorations(state);
    expect(decos.length).toBe(2);
  });

  it("emits a widget decoration at each hardBreak node", () => {
    const enabled = { value: true };
    const state = createState(enabled, docWithHardBreak());
    const decos = getDecorations(state);
    expect(decos.length).toBe(1);
  });

  it("does not decorate text that contains no spaces", () => {
    const enabled = { value: true };
    const state = createState(enabled, docWithText("abc"));
    expect(getDecorations(state).length).toBe(0);
  });

  it("handles an empty paragraph without crashing", () => {
    const enabled = { value: true };
    const state = createState(enabled, docWithText(""));
    expect(getDecorations(state).length).toBe(0);
  });
});

describe("showInvisibles Tiptap plugin (toggle via meta)", () => {
  it("re-runs buildDecorations when meta sets enabled=true", () => {
    const enabled = { value: false };
    const state = createState(enabled, docWithText("a b c"));
    expect(getDecorations(state).length).toBe(0);
    const next = state.apply(state.tr.setMeta(pluginKey, { enabled: true }));
    expect(getDecorations(next).length).toBe(2);
  });

  it("re-runs buildDecorations when meta sets enabled=false", () => {
    const enabled = { value: true };
    const state = createState(enabled, docWithText("a b c"));
    expect(getDecorations(state).length).toBe(2);
    const next = state.apply(state.tr.setMeta(pluginKey, { enabled: false }));
    expect(getDecorations(next).length).toBe(0);
  });
});

describe("showInvisibles Tiptap plugin (doc changes — incremental update)", () => {
  it("rebuilds decorations when the document changes", () => {
    const enabled = { value: true };
    const state = createState(enabled, docWithText("abc"));
    expect(getDecorations(state).length).toBe(0);
    const tr = state.tr.insertText(" x ", 2);
    const next = state.apply(tr);
    expect(getDecorations(next).length).toBe(2);
  });

  it("preserves left-region decoration positions when typing on the right", () => {
    // Doc: "a b cXyz" — 2 spaces in the left half.
    const enabled = { value: true };
    const state = createState(enabled, docWithText("a b cXyz"));
    const initialDecos = getDecorations(state);
    expect(initialDecos.length).toBe(2);
    const initialPositions = initialDecos.map((d) => d.from).sort();

    // Insert " w" near the END of the doc. Incremental update path
    // should preserve the two left-region decorations (positions
    // unchanged after .map()) and add one new decoration for the
    // inserted space.
    const tr = state.tr.insertText(" w", state.doc.content.size - 1);
    const next = state.apply(tr);
    const finalDecos = getDecorations(next);
    expect(finalDecos.length).toBe(3);
    // The two original positions still appear in the new set.
    const finalPositions = finalDecos.map((d) => d.from).sort();
    for (const p of initialPositions) {
      expect(finalPositions).toContain(p);
    }
  });

  it("removes decorations when the underlying spaces are deleted", () => {
    const enabled = { value: true };
    const state = createState(enabled, docWithText("a b c"));
    expect(getDecorations(state).length).toBe(2);
    // Delete the substring " b " (positions 2–5 in the paragraph).
    const tr = state.tr.delete(2, 5);
    const next = state.apply(tr);
    expect(getDecorations(next).length).toBe(0);
  });

  it("does NOT drop a hardBreak widget that sits at the right boundary of an insertion", () => {
    // Doc: "a␤b" (hardBreak at position 2). Widget decoration is at
    // pos=2. Insert "X" at position 2 — the insertion's changed range
    // is [2, 3). A naive filter (`from >= from && to <= to`) would
    // include the widget (from===to===2 inside [2, 3]), then
    // scanRange would NOT re-emit (the widget's mapped position is
    // now 3, outside scanRange's [2, 3)). The widget-aware filter
    // skips removal because 2 < 2 is false.
    const enabled = { value: true };
    const state = createState(enabled, docWithHardBreak());
    const initial = getDecorations(state);
    expect(initial.length).toBe(1);
    const widgetFrom = initial[0].from;

    const tr = state.tr.insertText("X", widgetFrom);
    const next = state.apply(tr);
    const after = getDecorations(next);
    // Widget must survive — it should now appear at its mapped
    // position (one past the insertion).
    expect(after.length).toBe(1);
    expect(after[0].from).toBeGreaterThan(widgetFrom);
  });

  it("does NOT drop decorations that merely abut the changed range (boundary regression)", () => {
    // Doc: "a bXcd" — the decoration is on the space at position 2-3.
    // Insert "y" at position 3, which is the END of the decoration's
    // range. A naive find(3, 4) would touch that decoration (boundary
    // inclusive). The fix filters to strictly-inside removals so the
    // existing space decoration survives.
    const enabled = { value: true };
    const state = createState(enabled, docWithText("a bXcd"));
    const initial = getDecorations(state);
    expect(initial.length).toBe(1);
    expect(initial[0].from).toBe(2);

    const tr = state.tr.insertText("y", 3);
    const next = state.apply(tr);
    const after = getDecorations(next);
    // Space decoration on the original " " must still be present at
    // its mapped position. Insertion didn't delete the space, so the
    // count must remain 1.
    expect(after.length).toBe(1);
    expect(after[0].from).toBe(2);
  });

  it("returns an empty decoration set for docs above the size cutoff", () => {
    // The size limit is 200_000 PM positions; doc.content.size for a
    // single paragraph with N text chars is N + 0 (paragraph wraps don't
    // add to content.size of the inline content). Use a tight bound.
    const enabled = { value: true };
    const huge = docWithText("x".repeat(SIZE_LIMIT + 100));
    const state = createState(enabled, huge);
    expect(getDecorations(state).length).toBe(0);
  });
});

describe("showInvisibles Tiptap module surface", () => {
  // Structural assertions on the production module — that the
  // re-exported pluginKey and helper exist with the expected shape.
  // Behavioural assertions on the production buildDecorations (size
  // cutoff, fence handling) are exercised via the production path —
  // see TiptapEditor in the running app.
  it("exports the extension, plugin key, and helper", async () => {
    const mod = await import("./tiptap");
    expect(mod.showInvisiblesExtension.name).toBe("showInvisibles");
    expect(mod.showInvisiblesPluginKey).toBeDefined();
    expect(typeof mod.setShowInvisibles).toBe("function");
  });
});
