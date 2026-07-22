/**
 * Resolver adoption gate — ADR-015 D6.
 *
 * The ADR audit (dev-docs/audit/20260722-adr-reality-audit.md) found FOUR
 * foundations that shipped, were marked Accepted, and were never adopted:
 * `useWorkspace()` (zero production imports), `pluginsFor()` (zero callers),
 * `EditorHost` (two comments), and ADR-007's slot seam (no host either side).
 *
 * The resolver in this directory is the fifth such foundation, and it is
 * currently unadopted too — Phase 3 migrates composition onto it. The rule that
 * came out of that audit was:
 *
 *   > An acceptance gate must count ADOPTION, never existence.
 *
 * So this test counts the composition paths that still bypass the resolver and
 * pins the number. It ratchets DOWN: when Phase 3 migrates a path, the count
 * drops and this expectation is lowered. If it ever reaches 0 the resolver is
 * genuinely the only path to composition, which is the D1 contract.
 *
 * It is deliberately a failing-forward gate: the number cannot silently grow,
 * and the resolver cannot quietly become decoration.
 *
 * @module lib/extensions/adoption.test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Composition roots that build an extension list WITHOUT the resolver.
 *
 * Remove an entry only when that file actually routes through
 * `resolveExtensions`, and lower `UNMIGRATED_COMPOSITION_ROOTS` to match.
 */
const BYPASSING_COMPOSITION_ROOTS = [
  "src/services/assembly/tiptapExtensions.ts",
  "src/services/assembly/sourceEditorExtensions.ts",
] as const;

/** Ratchets DOWN only. Phase 3 drives this to 0. */
const UNMIGRATED_COMPOSITION_ROOTS = 1;

describe("resolver adoption (ADR-015 D6 — count adoption, not existence)", () => {
  it("pins how many composition roots still bypass the resolver", () => {
    const bypassing = BYPASSING_COMPOSITION_ROOTS.filter((relative) => {
      const source = readFileSync(join(root, relative), "utf8");
      return !source.includes("resolveExtensions");
    });

    expect(
      bypassing.length,
      `Composition roots bypassing the resolver: ${bypassing.join(", ") || "none"}.\n` +
        "This number ratchets DOWN only. If it grew, a new hand-wired composition\n" +
        "path was added — route it through resolveExtensions instead. If it shrank,\n" +
        "lower UNMIGRATED_COMPOSITION_ROOTS to lock the win in.",
    ).toBe(UNMIGRATED_COMPOSITION_ROOTS);
  });

  it("names every known composition root, so the gate cannot be narrowed silently", () => {
    // Guards against 'fixing' the gate by deleting entries from the list rather
    // than migrating them.
    expect(BYPASSING_COMPOSITION_ROOTS.length).toBeGreaterThanOrEqual(
      UNMIGRATED_COMPOSITION_ROOTS,
    );
  });
});
