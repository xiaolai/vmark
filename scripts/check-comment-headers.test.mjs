// Self-test for the doc-header pre-commit warning.
//
// This hook had none, and it had drifted from its own stated behaviour: the
// comment said it detected "lines starting with *, //, //!", while the code
// only matched added lines containing a LABEL (`Purpose:`, `@module`, …). So
// rewriting the body of a Key-decisions bullet — the commonest way a header is
// legitimately updated — counted as not touching the header at all. Three of
// six warnings on one real commit were files whose headers HAD been updated.
//
// The property both directions matter for: a warning that fires on correct work
// is one people learn to scroll past, and a warning that stays silent on a
// forgotten header is the thing the hook exists to prevent. Each test below
// pins one of those directions against a real git repo.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOOK = resolve("scripts/check-comment-headers.sh");

let repo;

/** Run a command in the fixture repo. */
function git(...args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

/** Run the hook against whatever is staged; returns its stdout. */
function runHook() {
  return execFileSync("bash", [HOOK], { cwd: repo, encoding: "utf8" });
}

const HEADER = `/**
 * Purpose: do the thing.
 *
 * Key decisions:
 *   - the first decision
 *
 * @module fixture
 */
`;

function writeSubject(body, header = HEADER) {
  writeFileSync(join(repo, "src", "subject.ts"), `${header}\nexport function f() {\n${body}\n}\n`);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "vmark-header-hook-"));
  mkdirSync(join(repo, "src"));
  mkdirSync(join(repo, "scripts"));
  git("init", "-q");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  writeSubject("  return 1;");
  git("add", "-A");
  git("commit", "-qm", "base");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("check-comment-headers", () => {
  it("warns when code changed and the header did not", () => {
    writeSubject("  return 2;");
    git("add", "-A");
    expect(runHook()).toContain("subject.ts has a Purpose: header that wasn't updated");
  });

  it("stays silent when a header LABEL line was added", () => {
    writeSubject("  return 2;", HEADER.replace(" * @module fixture", " * @coordinates-with x.ts — y\n * @module fixture"));
    git("add", "-A");
    expect(runHook()).not.toContain("wasn't updated");
  });

  it("stays silent when a header's BODY was rewritten — the regression", () => {
    // No label on the changed line. The old keyword-only rule warned here, on
    // a header that had just been updated.
    writeSubject("  return 2;", HEADER.replace("the first decision", "the first decision, reconsidered"));
    git("add", "-A");
    expect(runHook()).not.toContain("wasn't updated");
  });

  it("stays silent when a header BULLET was added", () => {
    writeSubject(
      "  return 2;",
      HEADER.replace(" *   - the first decision", " *   - the first decision\n *   - a second decision"),
    );
    git("add", "-A");
    expect(runHook()).not.toContain("wasn't updated");
  });

  it("still warns when only a comment INSIDE the body changed", () => {
    // An inline comment deep in a function is not the header. Treating any
    // added comment as "header touched" would silence the check almost always.
    writeSubject("  // an inline note\n  return 2;");
    git("add", "-A");
    expect(runHook()).toContain("wasn't updated");
  });

  // Audit finding #13. The header text and its boundaries were read from the
  // WORKING TREE while the diff came from the staged index, so a partially
  // staged file was judged against content git is not committing.
  it("measures the header block from the STAGED blob, not the working tree", () => {
    // Discriminating case: the staged header is LONG and its edited line falls
    // inside it, while the working tree has a SHORT header so that same line
    // number falls outside. Reading the working tree therefore concludes "not
    // a header change" about content git is not committing, and warns on a
    // header that was in fact updated.
    const LONG = `/**\n * Purpose: do the thing.\n *\n * Key decisions:\n *   - one\n *   - two\n *   - three\n *   - four\n *   - five\n *   - six\n *\n * @module fixture\n */\n`;
    writeSubject("  return 1;", LONG);
    git("add", "-A");
    git("commit", "-qm", "long header");

    // Stage: edit a header BODY line deep in the block (no label word) + code.
    writeSubject("  return 2;", LONG.replace(" *   - six", " *   - six, revised"));
    git("add", "-A");
    // Working tree only: collapse the header so the staged line is out of range.
    writeSubject("  return 2;", `/**\n * Purpose: do the thing.\n */\n`);

    expect(runHook()).not.toContain("wasn't updated");
  });

  // Audit finding #14. Deleting a limitation that no longer applies IS
  // updating the header; warning about it is a false positive.
  it("accepts a deletion-only header edit", () => {
    writeSubject("  return 2;", HEADER.replace(" *   - the first decision\n", ""));
    git("add", "-A");
    expect(runHook()).not.toContain("wasn't updated");
  });

  // Round-2 regression (verify verdict #14 REGRESSED). Recognising deletions
  // must not swallow the ordinary case: deleting the FIRST BODY line produces
  // a hunk at the same position as deleting the LAST HEADER line, so a rule
  // keyed on the new-file position cannot tell them apart and silenced a real
  // warning. The old-side range is unambiguous.
  it("still warns when a deletion removes the first BODY line", () => {
    // NO blank line between header and code: that is what makes the deletion
    // hunk land at the same new-file position as a last-header-line deletion,
    // which is the ambiguity the position-based rule could not resolve.
    const tight = (body) =>
      writeFileSync(join(repo, "src", "subject.ts"), `${HEADER}export const a = 1;\n${body}\n`);
    tight("export const b = 2;\nexport const c = 3;");
    git("add", "-A");
    git("commit", "-qm", "tight");
    tight("export const c = 3;"); // header untouched; a body line deleted
    git("add", "-A");
    expect(runHook()).toContain("wasn't updated");
  });

  it("accepts a deletion of the LAST header line", () => {
    writeSubject("  return 2;", HEADER.replace(" * @module fixture\n", ""));
    git("add", "-A");
    expect(runHook()).not.toContain("wasn't updated");
  });

  // Audit finding #16 (round 2). `#` is not a comment in any file type this
  // hook scans (.ts/.tsx/.rs) — but it IS valid code there: a TS private field
  // and a Rust attribute both start with it.
  it("is not silenced by a TypeScript private field mentioning a label", () => {
    writeSubject('  return 2;', HEADER + '\nclass C {\n  #Purpose: number = 1;\n}\n');
    git("add", "-A");
    expect(runHook()).toContain("wasn't updated");
  });

  // Audit finding #16. The label rule matched anywhere on an added line, so a
  // string literal containing "Purpose:" silenced the warning.
  it("is not silenced by a code line containing a label word", () => {
    writeSubject('  const s = "Purpose: not a header";\n  return 2;');
    git("add", "-A");
    expect(runHook()).toContain("wasn't updated");
  });

  // Round-4. `*`-followed-by-space still admitted a SPACED deref
  // (`* slot = "Purpose: x";`) and a spaced TypeScript generator
  // (`* method() { return "Purpose:"; }`). Neither is a comment; both are
  // ordinary code that happens to mention a label word. The prefix cannot tell
  // them apart on its own — only the line's position inside a real comment
  // block can.
  it("is not silenced by a SPACED Rust deref mentioning a label", () => {
    const p = join(repo, "src", "e.rs");
    writeFileSync(p, `//! Purpose: do the thing.\n\nfn f() {}\n`);
    git("add", "-A");
    git("commit", "-qm", "add e.rs");
    writeFileSync(p, `//! Purpose: do the thing.\n\nfn f(slot: &mut &str) {\n* slot = "Purpose: runtime";\n}\n`);
    git("add", "-A");
    expect(runHook()).toContain("e.rs");
  });

  it("is not silenced by a spaced TypeScript generator mentioning a label", () => {
    writeSubject("  return 2;", HEADER + '\nclass C {\n* method() { return "Purpose:"; }\n}\n');
    git("add", "-A");
    expect(runHook()).toContain("wasn't updated");
  });

  it("still accepts a label added to a MID-FILE JSDoc block", () => {
    // The reason `*` cannot simply be dropped: this repo documents exports with
    // JSDoc below the header, and editing one IS a documentation update.
    const p = join(repo, "src", "mid.ts");
    const mid = (label) => `/**\n * Purpose: top.\n */\nexport const a = 1;\n\n/**\n * Does a thing.\n${label} */\nexport function f() { return 1; }\n`;
    writeFileSync(p, mid(""));
    git("add", "-A");
    git("commit", "-qm", "add mid");
    writeFileSync(p, mid(" * @coordinates-with x.ts — y\n").replace("return 1;", "return 2;"));
    git("add", "-A");
    expect(runHook()).not.toContain("mid.ts");
  });

  // Round-3 (verify verdict #16 PARTIAL). A bare `*` prefix also begins a Rust
  // deref assignment, so `*slot = "Purpose: ...";` looked like a JSDoc
  // continuation line. A comment continuation always has whitespace after the
  // asterisk; a deref never does.
  it("is not silenced by a Rust deref assignment mentioning a label", () => {
    const p = join(repo, "src", "d.rs");
    writeFileSync(p, `//! Purpose: do the thing.\n\nfn f() {}\n`);
    git("add", "-A");
    git("commit", "-qm", "add rs");
    writeFileSync(p, `//! Purpose: do the thing.\n\nfn f(slot: &mut &str) {\n*slot = "Purpose: runtime value";\n}\n`);
    git("add", "-A");
    expect(runHook()).toContain("d.rs");
  });

  it("still accepts a genuine JSDoc continuation line", () => {
    writeSubject("  return 2;", HEADER.replace(" * @module fixture", " * @coordinates-with y.ts — z\n * @module fixture"));
    git("add", "-A");
    expect(runHook()).not.toContain("wasn't updated");
  });

  // Audit finding #15. Unquoted word splitting mangles ordinary paths.
  it("handles a path containing a space", () => {
    const p = join(repo, "src", "with space.ts");
    writeFileSync(p, `${HEADER}\nexport const a = 1;\n`);
    git("add", "-A");
    git("commit", "-qm", "add spaced");
    writeFileSync(p, `${HEADER}\nexport const a = 2;\n`);
    git("add", "-A");
    expect(runHook()).toContain("with space.ts");
  });

  it("ignores a file with no Purpose: header", () => {
    writeFileSync(join(repo, "src", "plain.ts"), "export const a = 1;\n");
    git("add", "-A");
    git("commit", "-qm", "add plain");
    writeFileSync(join(repo, "src", "plain.ts"), "export const a = 2;\n");
    git("add", "-A");
    expect(runHook()).not.toContain("plain.ts");
  });

  it("ignores test files", () => {
    writeFileSync(join(repo, "src", "a.test.ts"), `${HEADER}\nexport const a = 1;\n`);
    git("add", "-A");
    git("commit", "-qm", "add test");
    writeFileSync(join(repo, "src", "a.test.ts"), `${HEADER}\nexport const a = 2;\n`);
    git("add", "-A");
    expect(runHook()).not.toContain("a.test.ts");
  });

  it("ignores a newly ADDED file", () => {
    // The filter is `--diff-filter=M`: a new file's header cannot be stale.
    writeFileSync(join(repo, "src", "fresh.ts"), `${HEADER}\nexport const a = 1;\n`);
    git("add", "-A");
    expect(runHook()).not.toContain("fresh.ts");
  });

  it("never blocks the commit, whatever it finds", () => {
    // It is advisory by design. A non-zero exit here would turn every
    // header-less edit into a hard stop.
    writeSubject("  return 2;");
    git("add", "-A");
    const status = execFileSync("bash", [HOOK, ";", "echo", "$?"], {
      cwd: repo,
      encoding: "utf8",
      // execFileSync throws on non-zero; reaching this line means exit 0.
    });
    expect(typeof status).toBe("string");
  });
});
