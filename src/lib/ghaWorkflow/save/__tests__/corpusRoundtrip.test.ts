// @vitest-environment node
// GHA workflow round-trip corpus gate (exhaustive by enumeration).
//
// Sweeps EVERY workflow in both corpora — the frozen real-world fixtures
// (src/test/fixtures/gha-workflows/) and the repo's own LIVE workflows
// (.github/workflows/, which the fixture set can lag behind) — through the
// two surfaces that interpret them:
//
//   1. Read side: parser `parse()` must not throw and must produce an IR
//      with zero error-severity diagnostics (measured true for all 33
//      files; pinned so a parser regression or a broken live workflow
//      fails here, not in production).
//   2. Save side: the ADR-11 no-op round trip. `parseAsCst` must report
//      zero document errors, and stringifyCst's output must be
//      semantically equal to the source with every comment and anchor
//      surviving.
//
// BYTE_IDENTICAL is an IDENTITY LIST, not a count (60-ai-governance §11:
// a count permits a like-for-like swap — one file regresses from
// byte-identical while another improves, total unchanged, gate silent).
// A listed file that stops being byte-identical fails (regression); an
// unlisted file that becomes byte-identical fails until listed (recorded
// win). cstParser.test.ts keeps the per-fixture ADR-11 conditions; this
// gate adds the live-workflow sweep and the identity ratchet.
//
// @coordinates-with ../cstParser.ts — parseAsCst / stringifyCst / semanticEqual
// @coordinates-with ../../parser — the read-side IR parse
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "../../parser";
import { parseAsCst, stringifyCst, semanticEqual } from "../cstParser";
import { walkWorkflows, commentSet, anchorUsage } from "@/test/ghaCorpusHelpers";

const CORPUS_ROOTS = ["src/test/fixtures/gha-workflows", ".github/workflows"];

/** Pinned so a file vanishing from either root fails rather than shrinking the sweep. */
// 37 since 2026-08-09: gate-liveness.yml and baseline-review.yml (WI-AF2.4,
// WI-AF3.3) joined the live root. Adding a workflow is meant to require
// touching this number — that is the pin working, not an obstacle to route
// around.
// 38 since 2026-08-17: pdf-smoke.yml — the exporter's three native backends
// had no cross-platform run anywhere in CI.
// 39 since 2026-08-19: release-smoke.yml (WI-NB9.2) — proves a published release
// artefact actually runs (Gatekeeper + the bundled sidecar), which release.yml
// signs and uploads but never exercises.
// 38 since 2026-08-20: star-history.yml DELETED. star-history.com issues a
// sealed token again, so the README embeds the hosted chart and the whole
// self-hosted generator went with it. The count moves DOWN here for the first
// time — the pin is two-way on purpose.
// 39 since 2026-08-21: rust-scheduled.yml — ci.yml's Rust gate is path-filtered,
// so `stable` toolchain drift accumulated unseen between Rust-touching PRs. Two
// clippy 1.98 errors were latent on main until a version-string bump happened to
// touch Cargo.toml and made the job run.
const EXPECTED_FILE_COUNT = 39;

/**
 * Workflows whose no-op round trip is BYTE-identical today. Two-way
 * identity ratchet — see the header. Paths are repo-relative.
 */
const BYTE_IDENTICAL: ReadonlySet<string> = new Set([
  ".github/workflows/ci.yml",
  ".github/workflows/claude-cost-report.yml",
  ".github/workflows/pdf-smoke.yml",
  ".github/workflows/release-smoke.yml",
  ".github/workflows/soak.yml",
  ".github/workflows/release.yml",
  ".github/workflows/rust-cache-warm.yml",
  ".github/workflows/rust-coverage.yml",
  "src/test/fixtures/gha-workflows/bun/format.yml",
  "src/test/fixtures/gha-workflows/sveltejs-svelte/ci.yml",
  "src/test/fixtures/gha-workflows/vite/ci.yml",
  "src/test/fixtures/gha-workflows/vmark/ci.yml",
  "src/test/fixtures/gha-workflows/vmark/claude-cost-report.yml",
  "src/test/fixtures/gha-workflows/vmark/release.yml",
  "src/test/fixtures/gha-workflows/vmark/update-homebrew.yml",
  "src/test/fixtures/gha-workflows/vuejs-core/ci.yml",
]);

const files = CORPUS_ROOTS.flatMap(walkWorkflows).sort();

describe("GHA workflow corpus", () => {
  it("enumerates both corpora (fixtures + live .github/workflows)", () => {
    // Exact: a lower bound lets files silently disappear from the sweep.
    expect(files.length).toBe(EXPECTED_FILE_COUNT);
    expect(files.some((f) => f.startsWith(".github/workflows/"))).toBe(true);
  });

  it("lists only existing files in BYTE_IDENTICAL", () => {
    const known = new Set(files);
    expect([...BYTE_IDENTICAL].filter((f) => !known.has(f))).toEqual([]);
  });

  for (const file of files) {
    describe(file, () => {
      const src = readFileSync(file, "utf8");

      it("parses to an IR with zero error diagnostics", () => {
        const ir = parse(src, file);
        expect(
          ir.diagnostics
            .filter((d) => d.severity === "error")
            .map((d) => d.message),
        ).toEqual([]);
      });

      it("survives the ADR-11 no-op round trip", () => {
        const doc = parseAsCst(src);
        expect(doc.errors).toEqual([]);
        const saved = stringifyCst(doc);
        expect(semanticEqual(src, saved)).toBe(true);
        expect(commentSet(saved)).toEqual(commentSet(src));
        expect(anchorUsage(saved)).toEqual(anchorUsage(src));
      });

      it("holds its byte-identity ratchet state", () => {
        const saved = stringifyCst(parseAsCst(src));
        const identical = saved === src;
        const listed = BYTE_IDENTICAL.has(file);
        if (identical && !listed) {
          expect.fail(
            `${file} round-trips BYTE-identically but is not in BYTE_IDENTICAL —` +
              ` record the win by adding it.`,
          );
        }
        if (!identical && listed) {
          expect.fail(
            `${file} is listed in BYTE_IDENTICAL but its round trip now differs —` +
              ` a formatting regression on the save path. Fix it (or, if the file` +
              ` itself legitimately changed format, remove it from the list).`,
          );
        }
      });
    });
  }
});
