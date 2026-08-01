/**
 * DRIFT GATE between the two remaining fence parsers.
 *
 * `plugins/shared/lineContent.ts` (`fenceRanges`) is the authority on the
 * fence grammar; `codeFenceDetection.ts` keeps its own traversal because its
 * consumers need positional info (language token bounds) and different
 * opener-line semantics. "Documented as the authority" is only prose — this
 * file is the enforcement. It feeds the SAME fixtures to both parsers:
 *
 *   - where the grammars must agree, agreement is asserted, so either side
 *     drifting fails here rather than shipping as a guard hole;
 *   - where they deliberately diverge, BOTH current behaviours are pinned,
 *     so a change to either side is a visible decision, not an accident.
 *
 * The full traversal consolidation (a positional-info adapter over
 * `fenceRanges`) is tracked in
 * `.claude/tdd-guardian/design-20260731-source-structure-service.md`.
 *
 * @coordinates-with ../codeFenceDetection.ts — the traversal under guard
 * @coordinates-with plugins/shared/lineContent.ts — the authority
 * @module plugins/sourceContextDetection/__tests__/fenceGrammarAgreement.test
 */
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { enclosingFence, fenceRanges } from "@/plugins/shared/fenceScanner";
import { getCodeFenceInfoAt } from "../codeFenceDetection";

/** Whether the SHARED scanner puts `lineIndex` inside a fence. */
function sharedInside(lines: string[], lineIndex: number): boolean {
  return enclosingFence(lines, lineIndex) !== null;
}

/** Whether codeFenceDetection puts the START of `lineIndex` inside a fence. */
function detectionInside(lines: string[], lineIndex: number): boolean {
  const state = EditorState.create({ doc: lines.join("\n") });
  return getCodeFenceInfoAt(state, state.doc.line(lineIndex + 1).from) !== null;
}

describe("delimiter grammar the two parsers MUST agree on", () => {
  // Content lines only: opener-line inclusion is an enumerated divergence
  // below, so agreement is asserted where the grammars claim the same thing.
  it.each([
    { label: "backtick fence content", lines: ["```", "code", "```"], line: 1, inside: true },
    { label: "TILDE fence content", lines: ["~~~", "code", "~~~"], line: 1, inside: true },
    {
      label: "content after a SHORT closer stays protected",
      lines: ["````", "code", "```", "still code"],
      line: 3,
      inside: true,
    },
    {
      label: "a backtick opener with a backtick in its info is not a fence",
      lines: ["``` foo`bar", "text"],
      line: 1,
      inside: false,
    },
    {
      label: "an NBSP-trailed run does not close — next line is still inside",
      lines: ["```", "x", "``" + "` ", "y"],
      line: 3,
      inside: true,
    },
    {
      label: "unclosed fence content is inside for BOTH",
      lines: ["```", "dangling"],
      line: 1,
      inside: true,
    },
    {
      label: "a paragraph after a CLOSED fence is outside for both",
      lines: ["```", "code", "```", "para"],
      line: 3,
      inside: false,
    },
    {
      label: "a longer closer still closes",
      lines: ["```", "code", "````", "after"],
      line: 3,
      inside: false,
    },
  ])("$label", ({ lines, line, inside }) => {
    expect(sharedInside(lines, line), "shared scanner").toBe(inside);
    expect(detectionInside(lines, line), "codeFenceDetection").toBe(inside);
  });
});

describe("enumerated divergences — BOTH sides pinned so drift is visible", () => {
  it("opener line of an UNCLOSED fence: shared says inside, detection says outside", () => {
    // Deliberate on detection's side: while the user is typing the third
    // backtick, autoPair must not think it is already inside its own fence.
    const lines = ["```", "dangling"];
    expect(sharedInside(lines, 0)).toBe(true);
    expect(detectionInside(lines, 0)).toBe(false);
  });

  it("a 4-space-indented opener: shared rejects (indented code), detection accepts", () => {
    // Detection is deliberately permissive: a fence nested two list levels
    // deep carries 4+ raw spaces, and a line-based parser cannot see the list.
    // Its own header argues a 4-space run outside a list is indented code —
    // still code — so guard semantics hold either way.
    const lines = ["    ```", "x", "    ```"];
    expect(fenceRanges(lines)).toEqual([]);
    expect(detectionInside(lines, 1)).toBe(true);
  });

  it("a 4-space CLOSER is still rejected by the shared default", () => {
    // The policy is a parameter, so the safety boundary keeps CommonMark's cap
    // while detection opts into the permissive reading. Pinning the DEFAULT
    // stops "detection needs it" from quietly becoming "everyone gets it".
    expect(fenceRanges(["```", "x", "    ```"])).toMatchObject([{ closed: false }]);
  });
});

describe("CLOSED gaps — these diverged until the grammars were unified", () => {
  it("a QUOTED fence is inside for BOTH", () => {
    // Detection's old patterns carried no container prefixes, so a fence in a
    // blockquote was invisible and the cursor-context guards did not engage
    // inside real code. It resolves through `fenceRanges` now, so the
    // container handling comes for free.
    const lines = ["> ```", "> code", "> ```"];
    expect(sharedInside(lines, 1)).toBe(true);
    expect(detectionInside(lines, 1)).toBe(true);
  });

  it("a LIST-ITEM fence is inside for BOTH", () => {
    const lines = ["- ```", "  code", "  ```"];
    expect(sharedInside(lines, 1)).toBe(true);
    expect(detectionInside(lines, 1)).toBe(true);
  });

  it("a fence in a NESTED blockquote is inside for both", () => {
    const lines = [">> ```", ">> code", ">> ```"];
    expect(sharedInside(lines, 1)).toBe(true);
    expect(detectionInside(lines, 1)).toBe(true);
  });

  it("an ORDERED list item's fence is inside for both", () => {
    const lines = ["1. ```", "   code", "   ```"];
    expect(sharedInside(lines, 1)).toBe(true);
    expect(detectionInside(lines, 1)).toBe(true);
  });

  it("a quoted fence is not closed by an UNQUOTED delimiter, for both", () => {
    // Container-aware pairing, which detection could not do at all before.
    const lines = ["> ```", "> code", "```", "after"];
    expect(sharedInside(lines, 3)).toBe(true);
    expect(detectionInside(lines, 3)).toBe(true);
  });
});
