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
import { describe, it, expect, beforeAll } from "vitest";
import { parseMarkdown } from "@/utils/markdownPipeline";
import { getProductionSchema } from "@/test/productionSchema";
import { docFingerprint } from "@/utils/markdownPipeline/__tests__/fidelity/docFingerprint";
import { runOnWysiwyg, runOnSource, disposeSurfaces, type Target } from "./surfaces";
import { COVERED_ACTIONS, DOCS } from "./parityFixtures";
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

const ACTIONS = COVERED_ACTIONS;

const SHAPES = ["range", "caret"] as const;

interface Comparison {
  agree: boolean;
  wysiwyg: string;
  source: string;
  wysiwygError?: string;
  sourceError?: string;
}

/**
 * The full result matrix, computed ONCE in `beforeAll`.
 *
 * Computed once for CORRECTNESS: the per-case assertions and the staleness
 * check must agree, and when each computed its own results they ran against a
 * shared editor whose accumulated state could in principle make them disagree
 * about the same cell. Reading one matrix removes that possibility.
 *
 * Built in `beforeAll` rather than at module scope because it boots a real
 * Tiptap editor and runs ~750 surface pairs. At import time that work blocks the
 * worker while OTHER test files are still resolving their own dynamic imports,
 * and it pushed `actionApplicability.test.ts` past vitest's 5s default — a
 * timeout in an unrelated file, caused entirely by this one's import cost.
 *
 * The hook needs an explicit timeout because the build takes roughly twice
 * vitest's 10s default. Blowing it fails the FILE (so CI still catches it), but
 * the per-test line reads "skipped" rather than "failed", which is easy to skim
 * past — hence the generous ceiling.
 */
const HOOK_TIMEOUT_MS = 120_000;

const RESULTS = new Map<string, Comparison>();
const key = (action: string, docLabel: string, shape: string): string => `${action}|${docLabel}|${shape}`;

beforeAll(() => {
  for (const action of ACTIONS) {
    for (const doc of DOCS) {
      for (const shape of SHAPES) {
        const target: Target = shape === "range" ? { select: doc.needle } : { caret: doc.needle };
        const w = runOnWysiwyg(doc.markdown, target, action);
        const s = runOnSource(doc.markdown, target, action);
        RESULTS.set(key(action, doc.label, shape), {
          agree: meaning(w.markdown) === meaning(s.markdown),
          wysiwyg: w.markdown,
          source: s.markdown,
          wysiwygError: w.error,
          sourceError: s.error,
        });
      }
    }
  }
  disposeSurfaces();
}, HOOK_TIMEOUT_MS);

describe("toolbar adapter behavioral parity", () => {
  for (const action of ACTIONS) {
    describe(action, () => {
      const declared = PARITY_DIVERGENCES[action];

      for (const doc of DOCS) {
        for (const shape of SHAPES) {
          it(`agrees on ${doc.label} [${shape}]`, () => {
            const r = RESULTS.get(key(action, doc.label, shape));
            expect(r, "result matrix is missing this case").toBeDefined();
            if (!r) return;

            // A declared divergence is allowed to disagree, but never to throw.
            expect(r.wysiwygError ?? "", `wysiwyg threw on ${action}`).toBe("");
            expect(r.sourceError ?? "", `source threw on ${action}`).toBe("");

            expect(
              r.agree || declared
                ? ""
                : `\n  ${action} on ${doc.label} [${shape}]: the surfaces produced different documents.\n` +
                  `  wysiwyg: ${JSON.stringify(r.wysiwyg)}\n` +
                  `  source:  ${JSON.stringify(r.source)}\n` +
                  `  Converge them, or declare the divergence in PARITY_DIVERGENCES with a verdict.\n`,
            ).toBe("");
          });
        }
      }
    });
  }

  it("declares no divergence that has been converged", () => {
    const fixed = Object.keys(PARITY_DIVERGENCES).filter((action) =>
      DOCS.every((doc) => SHAPES.every((shape) => RESULTS.get(key(action, doc.label, shape))?.agree !== false)),
    );
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
