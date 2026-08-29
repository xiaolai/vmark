// WI-UI4.2 — the copy-convention classifier: casing register comes from the
// KEY pattern, and the title-case word test knows stop words, interpolations
// and possessive pronouns.
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCopyConventions, dialogLiteralFindings, titleCaseViolations } from "./check-i18n-keys";

describe("titleCaseViolations (R14)", () => {
  it.each([
    ["Save As…", false],
    ["Keep My Changes", false],
    ["Clear Recent Files", false],
    ["Open in New Window", false],
    ["Copy on select", true],
    ["Keep my Changes", true],
    ["Reload all", true],
  ])("%s → violation=%s", (value, expected) => {
    expect(titleCaseViolations(value)).toBe(expected);
  });

  it("ignores interpolations entirely", () => {
    expect(titleCaseViolations("Delete {{name}}")).toBe(false);
    expect(titleCaseViolations("Close {{count}} Tabs")).toBe(false);
  });

  it("an empty or symbol-only value is never a violation", () => {
    expect(titleCaseViolations("…")).toBe(false);
    expect(titleCaseViolations("")).toBe(false);
  });
});

describe("dialogLiteralFindings (WI-UI4.1 dialog/toast literal scan)", () => {
  it("flags a bare sonner toast() literal — the primary sonner API", () => {
    const src = `import { toast } from "sonner";\ntoast("Saved the file");`;
    const problems = dialogLiteralFindings("src/a.ts", src);
    expect(problems.some((p) => p.includes("hardcoded string"))).toBe(true);
  });

  it("follows an import alias — import { toast as notify } cannot evade", () => {
    const src = `import { toast as notify } from "sonner";\nnotify.error("It broke badly");`;
    const problems = dialogLiteralFindings("src/a.ts", src);
    expect(problems.some((p) => p.includes("hardcoded string"))).toBe(true);
  });

  it("a LOCAL function named toast is not sonner — no false positive", () => {
    const src = `function toast(msg: string) { return msg; }\ntoast("just a helper call");`;
    expect(dialogLiteralFindings("src/a.ts", src)).toEqual([]);
  });

  it("a keyed toast passes", () => {
    const src = `import { toast } from "sonner";\nimport i18n from "@/i18n";\ntoast(i18n.t("dialog:toast.saved"));`;
    expect(dialogLiteralFindings("src/a.ts", src)).toEqual([]);
  });
});

describe("checkCopyConventions baseline handling (fail closed)", () => {
  it("a missing baseline WITHOUT --update-copy fails instead of rewriting it", () => {
    const missing = join(tmpdir(), `copy-baseline-missing-${process.pid}.json`);
    expect(existsSync(missing)).toBe(false);
    expect(checkCopyConventions(false, missing)).toBe(false);
    expect(existsSync(missing)).toBe(false); // and it must NOT have written one
  });
});
