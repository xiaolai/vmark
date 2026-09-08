// @vitest-environment node
// Audit 20260907 round 2 — the save panel needs a file-LIKE path to populate its
// filename field, so `exportToHtml` appends `.html` and strips it back off to get
// the document FOLDER. Stripping unconditionally had one input that escaped: a
// basename of exactly `.html` strips down to the parent directory, and the export
// then publishes index.html / standalone.html / assets over whatever that folder
// already held. The transaction would back those files up rather than destroy
// them, but the export still lands in the wrong place, with no warning.
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

import { exportFolderPath } from "../useExportOperations";

describe("exportFolderPath", () => {
  it.each([
    ["/users/me/Docs/Report.html", "/users/me/Docs/Report"],
    ["/users/me/Docs/Report.HTML", "/users/me/Docs/Report"],
    ["/users/me/Docs/Report", "/users/me/Docs/Report"],
    ["/users/me/Docs/Report.html.html", "/users/me/Docs/Report.html"],
    ["C:\\users\\me\\Report.html", "C:\\users\\me\\Report"],
  ])("%s → %s", (selected, expected) => {
    expect(exportFolderPath(selected)).toBe(expected);
  });

  it.each([
    "/users/me/Docs/.html",
    "/users/me/Docs/.HTML",
    "C:\\users\\me\\.html",
    ".html",
  ])("keeps %s whole — stripping it would leave no folder name at all", (selected) => {
    expect(exportFolderPath(selected)).toBe(selected);
  });
});
