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
import { COVERED_ACTIONS, DOCS } from "./parityFixtures";
import { PARITY_DIVERGENCES, MAX_PARITY_DIVERGENCES } from "./parityLedger";
import { isBlockedInTableCell } from "../../actionApplicability";

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
 * Each cell is computed ONCE, on first use, and memoised.
 *
 * Once, for CORRECTNESS: the per-case assertions and the staleness check must
 * agree about a cell, and when each computed its own results they ran against a
 * shared editor whose accumulated state could in principle make them disagree.
 *
 * LAZILY, because computing all ~750 cells up front was the wrong shape twice
 * over. At module scope the work blocked the worker while other files were still
 * resolving dynamic imports, pushing `actionApplicability.test.ts` past vitest's
 * 5s default — a timeout in an unrelated file caused entirely by this one. Moved
 * into `beforeAll` it stopped blocking imports but became a single ~25s hook,
 * which then needed a raised `hookTimeout`; a hook that overruns fails the file
 * but reports every test inside it as "skipped", which reads like a pass at a
 * glance. Spreading the cost across the tests that actually need each cell
 * removes both problems rather than trading one for the other: no hook, no
 * import cost, and each case stays far inside the default per-test timeout.
 */
const RESULTS = new Map<string, Comparison>();
const key = (action: string, docLabel: string, shape: string): string => `${action}|${docLabel}|${shape}`;

function compare(action: string, doc: (typeof DOCS)[number], shape: (typeof SHAPES)[number]): Comparison {
  const cacheKey = key(action, doc.label, shape);
  const cached = RESULTS.get(cacheKey);
  if (cached) return cached;

  const target: Target = shape === "range" ? { select: doc.needle } : { caret: doc.needle };
  const w = runOnWysiwyg(doc.markdown, target, action);
  const s = runOnSource(doc.markdown, target, action);
  const result: Comparison = {
    agree: meaning(w.markdown) === meaning(s.markdown),
    wysiwyg: w.markdown,
    source: s.markdown,
    wysiwygError: w.error,
    sourceError: s.error,
  };
  RESULTS.set(cacheKey, result);
  return result;
}

afterAll(disposeSurfaces);

describe("toolbar adapter behavioral parity", () => {
  for (const action of ACTIONS) {
    describe(action, () => {
      const declared = PARITY_DIVERGENCES[action];

      for (const doc of DOCS) {
        for (const shape of SHAPES) {
          // Actions the availability policy forbids in a table cell are
          // unreachable in the app, so comparing what the raw adapters would do
          // to one is meaningless — this harness calls them directly, below that
          // gate. These cases are SKIPPED, visibly, rather than passed: the real
          // assertion that the executor refuses them lives in
          // `services/commands/actionAvailability.test.ts`.
          //
          // An earlier version "asserted the policy" here with
          // `if (blocked) expect(isBlockedInTableCell(action)).toBe(true)` — a
          // tautology that re-checked the condition the branch had just tested,
          // and so could never fail. It read as ~30 passing cases that verified
          // nothing.
          const unreachableHere = doc.label === "table" && isBlockedInTableCell(action);

          it.skipIf(unreachableHere)(`agrees on ${doc.label} [${shape}]`, () => {
            const r = compare(action, doc, shape);

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
      DOCS.every((doc) =>
        doc.label === "table" && isBlockedInTableCell(action)
          ? true // unreachable in a cell, so it cannot diverge there
          : SHAPES.every((shape) => compare(action, doc, shape).agree),
      ),
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
