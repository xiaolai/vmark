/**
 * The approval-dialog selectors this harness drives, checked against the real
 * component (audit R3 #8).
 *
 * These are STYLING classes, and styling has already moved underneath them
 * once: `.workspace-approval-approve` existed nowhere in `src/`, so the click
 * matched nothing, silently did nothing, and returned true. That failure is
 * invisible without a running app, which is exactly why it survived — so the
 * coupling is pinned here, where `check:static` runs it.
 *
 * @coordinates-with e2e/lib/workspace.mjs — the selectors
 * @coordinates-with src/components/Workspace/WorkspaceApprovalDialog.tsx — the markup
 * @module e2e/lib/workspace.test
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  APPROVAL_APPROVE,
  APPROVAL_DENY,
  APPROVAL_OVERLAY,
  APPROVAL_PATH,
  APPROVAL_SOURCE,
} from "./workspace.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(join(REPO, APPROVAL_SOURCE), "utf8");

/** Every class name the component writes into a `className="…"` literal. */
const classNames = new Set(
  [...source.matchAll(/className="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/).filter(Boolean)),
);

/** The leading class of a compound selector, e.g. `.a .b--c` → "a". */
const rootClass = (selector) => selector.slice(1).split(/[\s:]/)[0];

describe("the approval-dialog selectors the harness drives", () => {
  it.each([
    ["overlay", APPROVAL_OVERLAY],
    ["path", APPROVAL_PATH],
    ["approve", APPROVAL_APPROVE],
    ["deny", APPROVAL_DENY],
  ])("%s: its anchor class is still on the dialog", (_label, selector) => {
    expect(classNames.has(rootClass(selector))).toBe(true);
  });

  // The approve/deny pair is told apart by `--primary`, so the action row must
  // hold exactly one primary button and exactly one that is not. Two primaries
  // (or none) makes `querySelector` pick by document order, i.e. by accident.
  it("the action row holds exactly one primary button and one plain one", () => {
    const row = source.slice(source.indexOf('className="workspace-approval-actions"'));
    const buttons = [...row.matchAll(/<button[^>]*className="([^"]*)"/g)].map((m) => m[1].split(/\s+/));
    const primary = buttons.filter((c) => c.includes("vm-btn") && c.includes("vm-btn--primary"));
    const plain = buttons.filter((c) => c.includes("vm-btn") && !c.includes("vm-btn--primary"));
    expect(primary).toHaveLength(1);
    expect(plain).toHaveLength(1);
  });

  it("does not resurrect the class that matched nothing", () => {
    for (const selector of [APPROVAL_APPROVE, APPROVAL_DENY]) {
      expect(selector).not.toContain("workspace-approval-approve");
    }
    expect(source).not.toContain("workspace-approval-approve");
  });
});
