/**
 * WI-4.1 — stateful editing-op fuzz on the production stack.
 *
 * fast-check generates op traces (typing incl. CJK/emoji/combining/RTL,
 * selection moves, Enter/Backspace/Delete, mark toggles, list ops,
 * undo/redo) and applies them through the WI-1.2 typing harness — real
 * input rules, keymaps, handleDOMEvents, history. fast-check, not a bespoke
 * PRNG: shrinking and seed reporting come free, and a failure prints the
 * minimized trace (see the planted-bug self-test, which pins that contract).
 *
 * Invariants:
 *   per op   — doc.check() passes; selection stays in bounds.
 *   per trace — EDITING FINGERPRINT: fp(doc) === fp(parse(serialize(doc))).
 *               Serialize-stability alone misses first-pass destruction
 *               (fidelity/roundtripFidelity.test.ts documents why); the
 *               fingerprint excludes derived attrs (sourceLine,
 *               blankLinesBefore, heading ids) so metadata cannot false-
 *               positive. Plus: serialize∘parse stable; undo-to-depth-0
 *               returns to the initial DOC (compared by fingerprint, not
 *               selection).
 *   per run  — op-kind coverage: every op kind must have been APPLIED at
 *              least once across the run, so an all-no-op generator cannot
 *              quietly pass.
 *
 * Budget: 25 runs × ≤40 ops (~1k transactions) — the roundtrip property
 * suite flaked at 200–300 CPU-bound runs under worker contention, so this
 * stays deliberately small in the PR tier; FUZZ_RUNS scales it in the soak.
 * Seed fixed for CI determinism; override with FUZZ_SEED to explore.
 *
 * Declared exclusion (measured): '[' is not in the text pools — autoPair's
 * bracket pairing plus link-reference parsing has a known escape-growth
 * defect family already pinned by the spec roundtrip ledger; the fuzz would
 * rediscover it every run. Deleting those ledger entries un-excludes this.
 *
 * @coordinates-with typingHarness.ts — the driver (WI-1.2)
 * @coordinates-with ../utils/markdownPipeline/adapter.ts — serialize/parse
 * @module test/editingFuzz.test
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { Node as PmNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline/adapter";
import { createTypingSession, type TypingSession } from "./typingHarness";

// ── op vocabulary ─────────────────────────────────────────────────────────
const TEXT_POOL = [
  "word", "a", "x y", "# ", "* ", "**b** ", "`c` ",
  "中文", "你好 ", "すし", "🙂", "👨‍👩‍👧", "é", "עברית ", "مرحبا ",
];
type Op =
  | { kind: "text"; text: string }
  | { kind: "enter" } | { kind: "backspace" } | { kind: "delete" }
  | { kind: "cursor"; frac: number }
  | { kind: "select"; a: number; b: number }
  | { kind: "mark"; mark: "bold" | "italic" | "strike" | "code" }
  | { kind: "list"; list: "bullet" | "ordered" | "sink" | "lift" }
  | { kind: "undo" } | { kind: "redo" };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...TEXT_POOL).map((text) => ({ kind: "text", text }) as Op) },
  { weight: 2, arbitrary: fc.constantFrom<Op>({ kind: "enter" }, { kind: "backspace" }, { kind: "delete" }) },
  { weight: 2, arbitrary: fc.nat(100).map((n) => ({ kind: "cursor", frac: n / 100 }) as Op) },
  { weight: 1, arbitrary: fc.tuple(fc.nat(100), fc.nat(100)).map(([a, b]) => ({ kind: "select", a, b }) as Op) },
  { weight: 2, arbitrary: fc.constantFrom("bold", "italic", "strike", "code").map((mark) => ({ kind: "mark", mark }) as Op) },
  { weight: 1, arbitrary: fc.constantFrom("bullet", "ordered", "sink", "lift").map((list) => ({ kind: "list", list }) as Op) },
  { weight: 1, arbitrary: fc.constantFrom<Op>({ kind: "undo" }, { kind: "redo" }) },
);

/**
 * A document position for `frac`, never INSIDE a surrogate pair.
 *
 * ProseMirror positions count UTF-16 code units, so a raw fraction can land
 * between the two halves of an astral character. Splitting there — with Enter,
 * or by typing at the caret — produces a document holding a lone high
 * surrogate in one block and a lone low surrogate in another: not text any
 * editor can produce, since a real caret cannot occupy that offset, and not
 * text that can survive a file round-trip either.
 *
 * The fuzz was manufacturing that state and then reporting the round-trip's
 * inability to preserve it as a defect (audit 20260906, while restoring the
 * oracle for C8). Nudging FORWARD past the low half keeps every legitimate
 * position reachable.
 */
function posAt(session: TypingSession, frac: number): number {
  const doc = session.editor.state.doc;
  const size = doc.content.size;
  const pos = Math.max(0, Math.min(size, Math.round(frac * size)));

  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.isTextblock) return pos;
  const offset = $pos.parentOffset;
  if (offset <= 0 || offset >= parent.content.size) return pos;

  // `textBetween` over the whole textblock, so the check sees the code unit on
  // each side of the boundary regardless of which text child it belongs to.
  const text = parent.textBetween(0, parent.content.size);
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  const insidePair =
    before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
  return insidePair ? Math.min(size, pos + 1) : pos;
}

function moveNear(session: TypingSession, pos: number, to?: number): void {
  const state = session.editor.view.state;
  const $a = state.doc.resolve(pos);
  const sel =
    to === undefined
      ? TextSelection.near($a)
      : TextSelection.between($a, state.doc.resolve(to));
  session.editor.view.dispatch(state.tr.setSelection(sel));
}

function applyOp(session: TypingSession, op: Op): void {
  switch (op.kind) {
    case "text": session.type(op.text); break;
    case "enter": session.press("Enter"); break;
    case "backspace": session.press("Backspace"); break;
    case "delete": session.press("Delete"); break;
    case "cursor": moveNear(session, posAt(session, op.frac)); break;
    case "select": moveNear(session, posAt(session, op.a / 100), posAt(session, op.b / 100)); break;
    case "mark": session.editor.commands.toggleMark(op.mark); break;
    case "list":
      if (op.list === "bullet") session.editor.commands.toggleBulletList();
      else if (op.list === "ordered") session.editor.commands.toggleOrderedList();
      else if (op.list === "sink") session.editor.commands.sinkListItem("listItem");
      else session.editor.commands.liftListItem("listItem");
      break;
    case "undo": session.undo(); break;
    case "redo": session.redo(); break;
  }
}

// ── editing fingerprint: structure + text + marks, minus derived attrs ────
// EMPTY textblocks are excluded from the fingerprint: markdown cannot spell
// an empty paragraph (a trailing blank line collapses on parse), so the
// editor-created trailing paragraph is KNOWN-lossy through serialization.
// The fuzz found this on its third run and shrank it to 5 ops; encoding it
// here is the declared form of that normalization, not a suppression — a
// NON-empty node vanishing still fails.
// Likewise, LINE-EDGE whitespace in a textblock is unrepresentable: markdown
// strips trailing spaces (or reads them as a hard break) and eats leading
// indentation, so "word# " legitimately reparses as "word#" (fuzz-found,
// shrunk to a 5-op trace). The fingerprint trims the edges of each
// textblock's first/last text child; interior whitespace still counts.
const DERIVED_ATTRS = new Set(["sourceLine", "blankLinesBefore", "id"]);
function isDroppedEmptyTextblock(node: PmNode): boolean {
  return node.isTextblock && node.content.size === 0;
}
/**
 * A MARK cannot begin or end with whitespace in markdown, so move any edge
 * whitespace out of marked runs before comparing.
 *
 * GFM's delimiter-flanking rules say a closing run may not be preceded by
 * whitespace, so `~~word ~~` does not close the strikethrough at all. The
 * editor's in-memory model can hold `strike("word ")`; the file format has no
 * spelling for it, and the serializer is obliged to emit `~~word~~ ` — which
 * reparses with the space outside the mark.
 *
 * This is the same declared-normalization family as the two above: a state
 * markdown cannot represent, normalized identically on both sides rather than
 * suppressed. It is NOT a weakening of the text-loss check — the
 * transformation only moves characters ACROSS a mark boundary, never removes
 * them, so a lost character still changes the fingerprint (audit 20260906, C8;
 * this was the fuzz's standing seed-0 failure, and the audit correctly refused
 * to call it corruption without a stated oracle policy).
 */
function normalizeMarkEdgeWhitespace(
  children: Array<{ x?: string; m?: string[] } & Record<string, unknown>>,
): Array<{ x?: string; m?: string[] } & Record<string, unknown>> {
  const out: Array<{ x?: string; m?: string[] } & Record<string, unknown>> = [];

  for (const child of children) {
    // Only marked TEXT runs can carry this ambiguity.
    if (typeof child.x !== "string" || !child.m?.length) {
      out.push(child);
      continue;
    }
    const leading = /^[ \t]+/.exec(child.x)?.[0] ?? "";
    const trailing = /[ \t]+$/.exec(child.x.slice(leading.length))?.[0] ?? "";
    const core = child.x.slice(leading.length, child.x.length - trailing.length);

    // An all-whitespace marked run has no core to keep the mark on.
    if (leading) out.push({ t: "text", x: leading });
    if (core) out.push({ ...child, x: core });
    if (trailing) out.push({ t: "text", x: trailing });
    if (!leading && !core && !trailing) out.push({ t: "text", x: child.x });
  }

  // Re-merge neighbours that now carry the same marks, so the split above
  // cannot itself become a difference.
  const merged: typeof out = [];
  for (const child of out) {
    const prev = merged[merged.length - 1];
    const sameMarks =
      prev &&
      typeof prev.x === "string" &&
      typeof child.x === "string" &&
      JSON.stringify(prev.m ?? []) === JSON.stringify(child.m ?? []);
    if (sameMarks) {
      prev.x = (prev.x as string) + child.x;
    } else {
      merged.push({ ...child });
    }
  }
  return merged;
}

function fingerprint(node: PmNode): unknown {
  const attrs = Object.fromEntries(
    Object.entries(node.attrs ?? {}).filter(
      ([k, v]) => !DERIVED_ATTRS.has(k) && v !== null && v !== undefined,
    ),
  );
  let children = node.content.childCount
    ? Array.from({ length: node.content.childCount }, (_, i) => {
        const child = node.child(i);
        if (isDroppedEmptyTextblock(child)) return null;
        return fingerprint(child) as { x?: string; m?: string[] } & Record<string, unknown>;
      }).filter((c): c is { x?: string; m?: string[] } & Record<string, unknown> => c !== null)
    : undefined;

  if (children && node.isTextblock) {
    // Mark-edge migration FIRST, then line-edge trimming: whitespace pushed out
    // of a mark at the start or end of the line is then trimmed by the existing
    // rule, exactly as the serializer's own output would be.
    children = normalizeMarkEdgeWhitespace(children);
    const count = children.length;
    children = children
      .map((child, i) => {
        if (typeof child.x !== "string") return child;
        let x = child.x;
        if (i === 0) x = x.replace(/^[ \t]+/, "");
        if (i === count - 1) x = x.replace(/[ \t]+$/, "");
        return x === "" ? null : { ...child, x };
      })
      .filter((c): c is { x?: string; m?: string[] } & Record<string, unknown> => c !== null);
  }
  return {
    t: node.type.name,
    ...(node.isText ? { x: node.text } : {}),
    ...(Object.keys(attrs).length ? { a: attrs } : {}),
    ...(node.marks.length ? { m: node.marks.map((m) => m.type.name).sort() } : {}),
    // Empty-after-normalization and absent must fingerprint identically.
    c: children && children.length > 0 ? children : undefined,
  };
}
const fp = (n: PmNode) => JSON.stringify(fingerprint(n));

const RUNS = Number(process.env.FUZZ_RUNS ?? "25");
const SEED = Number(process.env.FUZZ_SEED ?? "20260805");

describe("editing-op fuzz (production stack)", () => {
  it(`random op traces preserve every invariant (${RUNS} runs, seed ${SEED})`, () => {
    const applied = new Set<string>();
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 5, maxLength: 40 }), (ops) => {
        const session = createTypingSession({ markdown: "" });
        try {
          const initialFp = fp(session.editor.state.doc);
          for (const op of ops) {
            applyOp(session, op);
            applied.add(op.kind);
            session.editor.state.doc.check(); // throws on schema violation
            const { from, to } = session.editor.state.selection;
            const size = session.editor.state.doc.content.size;
            if (from < 0 || to > size) throw new Error(`selection out of bounds: ${from}..${to} > ${size}`);
          }
          // First-pass preservation: the EDITED DOC survives its own
          // serialization — not merely "the output restabilizes".
          const schema = session.editor.schema;
          const md1 = serializeMarkdown(schema, session.editor.state.doc);
          const reparsed = parseMarkdown(schema, md1);
          expect(fp(reparsed), `fingerprint changed through serialize/parse\nmd: ${JSON.stringify(md1)}`).toBe(
            fp(session.editor.state.doc),
          );
          // Stability anchors AFTER the first parse: md1 may carry
          // editor-only constructs (the empty trailing paragraph) that
          // normalize away in one parse; from md2 on, serialization must be
          // a fixed point.
          const md2 = serializeMarkdown(schema, reparsed);
          const md3 = serializeMarkdown(schema, parseMarkdown(schema, md2));
          expect(md3, "serialize∘parse not stable after normalization pass").toBe(md2);
          // Undo inverts to the initial document.
          let guard = 0;
          while (session.undo() && guard < 200) guard += 1;
          expect(fp(session.editor.state.doc), "undo-to-depth-0 differs from initial doc").toBe(initialFp);
        } finally {
          session.destroy();
        }
      }),
      { numRuns: RUNS, seed: SEED },
    );
    // Op coverage across the run: an all-no-op generator cannot pass.
    for (const kind of ["text", "enter", "backspace", "cursor", "mark", "undo"]) {
      expect(applied.has(kind), `op kind never applied: ${kind}`).toBe(true);
    }
  }, 120_000);

  it("PLANTED BUG self-test: a known-bad trace is found, shrunk, and reported with its seed", () => {
    // The fuzz harness's own contract: fast-check must catch a property
    // violation, minimize the trace, and print seed + counterexample. A
    // harness that stopped doing this would make the test above meaningless.
    let message = "";
    try {
      fc.assert(
        fc.property(fc.array(fc.constantFrom(...TEXT_POOL), { maxLength: 10 }), (texts) => {
          if (texts.some((t) => t.includes("中"))) throw new Error("planted bug reached");
          return true;
        }),
        { numRuns: 200, seed: SEED },
      );
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
      message = `${error instanceof Error ? error.message : String(error)}\n${cause}`;
    }
    // The underlying planted error travels in `cause` (fast-check v4).
    expect(message).toContain("planted bug reached");
    expect(message).toContain("seed");
    expect(message).toMatch(/Counterexample/i);
    // Shrinking worked: the minimized trace is a single-element array.
    expect(message).toMatch(/\[\s*"中文"\s*\]/);
  });
});
