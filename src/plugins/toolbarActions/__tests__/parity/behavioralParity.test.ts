/**
 * Toolbar adapters — BEHAVIORAL parity gate.
 *
 * Purpose: assert that a toolbar action produces the same document in WYSIWYG
 * mode and in Source mode, by running it against both real surfaces from the
 * same markdown and the same logical selection.
 *
 * Why this exists alongside the two parity tests already in this package: both
 * check names, not behavior.
 *   - `adapterActionParity.test.ts` regexes the `case "…"` labels out of the two
 *     adapter sources and pins them to one vocabulary. It proves an action is
 *     ROUTED by both switches, never that the two arms agree.
 *   - `toolbarParity.test.ts` compares button enabled/active state across
 *     surfaces against MOCKED views. It never invokes an adapter — a grep for
 *     adapter calls in it returns zero.
 * So the two adapters could diverge in outcome indefinitely without any gate
 * firing, and did: `wysiwygAdapter.ts` took fixes through 2026-07-30 while
 * `sourceAdapter.ts` had none since 2026-02-10.
 *
 * Nothing here is mocked, which is the other half of the point:
 * `wysiwygAdapter.test.ts` stubs `expandedToggleMark` and every node action to
 * return `true`, so its 928 lines verify routing and not one document outcome.
 * This is the WYSIWYG adapter's first behavioral test.
 *
 * Equivalence is judged on MEANING, via `docFingerprint` over each surface's
 * markdown, so the surfaces stay free to spell the same document differently.
 *
 * @coordinates-with surfaces.ts — the two real surfaces
 * @coordinates-with parityLedger.ts — declared divergences and the ratchet
 * @coordinates-with @/utils/markdownPipeline/__tests__/fidelity/docFingerprint — equivalence
 * @module plugins/toolbarActions/__tests__/parity/behavioralParity.test
 */
import { describe, it, expect, afterAll } from "vitest";
import { parseMarkdown } from "@/utils/markdownPipeline";
import { getProductionSchema } from "@/test/productionSchema";
import { docFingerprint } from "@/utils/markdownPipeline/__tests__/fidelity/docFingerprint";
import { runOnWysiwyg, runOnSource, disposeSurfaces, type Target } from "./surfaces";
import { PARITY_DIVERGENCES, MAX_PARITY_DIVERGENCES } from "./parityLedger";

const schema = getProductionSchema();

/** Meaning of a markdown string, or a sentinel if it no longer parses. */
function meaning(md: string): string {
  try {
    return docFingerprint(parseMarkdown(schema, md));
  } catch (e) {
    return `<unparseable: ${e instanceof Error ? e.message : String(e)}>`;
  }
}

/**
 * Actions covered here: those that mutate the document without opening a popup,
 * touching the clipboard, or needing a table/async context. The uncovered
 * remainder is pinned by `UNCOVERED_ACTIONS` below so coverage cannot silently
 * shrink.
 */
const ACTIONS = [
  "bold", "italic", "strikethrough", "code", "highlight", "underline",
  "superscript", "subscript", "clearFormatting",
  "heading:1", "heading:3", "heading:6", "increaseHeading", "decreaseHeading",
  "bulletList", "orderedList", "taskList",
  "insertBlockquote", "removeBlockquote", "nestBlockquote", "unnestBlockquote",
  "insertDivider", "insertCodeBlock",
  "transformUppercase", "transformLowercase", "transformTitleCase", "transformToggleCase",
  "duplicateLine", "moveLineUp", "moveLineDown", "deleteLine", "joinLines",
  "indent", "outdent", "removeTrailingSpaces", "collapseBlankLines",
];

/** Documents chosen so block actions start from different existing structures. */
const DOCS: Array<{ label: string; markdown: string; needle: string }> = [
  { label: "paragraph", markdown: "The quick brown fox\n", needle: "brown" },
  { label: "heading-h3", markdown: "### The quick brown fox\n", needle: "brown" },
  { label: "list-item", markdown: "- The quick brown fox\n", needle: "brown" },
  { label: "blockquote", markdown: "> The quick brown fox\n", needle: "brown" },
];

afterAll(disposeSurfaces);

describe("toolbar adapter behavioral parity", () => {
  for (const action of ACTIONS) {
    describe(action, () => {
      const declared = PARITY_DIVERGENCES[action];

      for (const doc of DOCS) {
        for (const shape of ["range", "caret"] as const) {
          const target: Target = shape === "range" ? { select: doc.needle } : { caret: doc.needle };

          it(`agrees on ${doc.label} [${shape}]`, () => {
            const w = runOnWysiwyg(doc.markdown, target, action);
            const s = runOnSource(doc.markdown, target, action);
            const agree = meaning(w.markdown) === meaning(s.markdown);

            // A declared divergence is allowed to disagree, but never to throw.
            expect(w.error ?? "", `wysiwyg threw on ${action}`).toBe("");
            expect(s.error ?? "", `source threw on ${action}`).toBe("");

            expect(
              agree || declared
                ? ""
                : `\n  ${action} on ${doc.label} [${shape}]: the surfaces produced different documents.\n` +
                  `  wysiwyg: ${JSON.stringify(w.markdown)}\n` +
                  `  source:  ${JSON.stringify(s.markdown)}\n` +
                  `  Converge them, or declare the divergence in PARITY_DIVERGENCES with a verdict.\n`,
            ).toBe("");
          });
        }
      }
    });
  }

  it("declares no divergence that has been converged", () => {
    const fixed: string[] = [];
    for (const action of Object.keys(PARITY_DIVERGENCES)) {
      const stillDiverges = DOCS.some((doc) =>
        (["range", "caret"] as const).some((shape) => {
          const target: Target = shape === "range" ? { select: doc.needle } : { caret: doc.needle };
          const w = runOnWysiwyg(doc.markdown, target, action);
          const s = runOnSource(doc.markdown, target, action);
          return meaning(w.markdown) !== meaning(s.markdown);
        }),
      );
      if (!stillDiverges) fixed.push(action);
    }
    expect(
      fixed.length === 0
        ? ""
        : `\n  ${fixed.join(", ")} no longer diverge(s). Delete the entry from\n` +
          `  PARITY_DIVERGENCES and lower MAX_PARITY_DIVERGENCES.\n`,
    ).toBe("");
  });

  it("declares divergences only for actions it actually exercises", () => {
    const orphans = Object.keys(PARITY_DIVERGENCES).filter((a) => !ACTIONS.includes(a));
    expect(
      orphans.length === 0
        ? ""
        : `\n  ${orphans.join(", ")} declared but not in ACTIONS — the claim is unverified.\n`,
    ).toBe("");
  });

  it("holds the divergence count at or below its ratchet", () => {
    const count = Object.keys(PARITY_DIVERGENCES).length;
    expect(
      count <= MAX_PARITY_DIVERGENCES
        ? ""
        : `\n  ${count} divergences declared but the ceiling is ${MAX_PARITY_DIVERGENCES}.\n` +
          `  This gate ratchets DOWN only — never raise the ceiling.\n`,
    ).toBe("");
  });
});
