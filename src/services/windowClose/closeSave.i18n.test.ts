// WI-RA19.4 — the save-on-close dialogs label their buttons through i18n, and
// recognise the TRANSLATED label the dialog hands back. They used English
// literals, so every locale saw "Save" / "Don't Save" / "Save All" / "Cancel".
// i18n is replaced by a marker translator: a label that bypasses t() shows up
// as plain English instead of a marker.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/i18n", () => ({
  default: {
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `<${key}|${JSON.stringify(opts)}>` : `<${key}>`,
  },
}));

vi.mock("@/services/persistence/saveToPath", () => ({
  saveToPathForClose: vi.fn(async () => true),
}));

import { message } from "@tauri-apps/plugin-dialog";
import { promptSaveForDirtyDocument, promptSaveForMultipleDocuments } from "./closeSave";

const SAVE = "<dialog:unsavedChanges.buttonSave>";
const DONT_SAVE = "<dialog:unsavedChanges.buttonDontSave>";
const SAVE_ALL = "<dialog:unsavedChanges.buttonSaveAll>";
const CANCEL = "<dialog:unsavedChanges.buttonCancel>";

const ctx = (tabId: string, filePath: string | null) => ({
  windowLabel: "main",
  tabId,
  title: tabId,
  filePath,
  content: "x",
});

type Buttons = { yes: string; no: string; cancel: string };
function buttonsOfLastDialog(): Buttons {
  const call = vi.mocked(message).mock.calls.at(-1);
  if (!call) throw new Error("no dialog shown");
  return (call[1] as { buttons: Buttons }).buttons;
}

beforeEach(() => {
  vi.mocked(message).mockReset();
});

describe("single-document save dialog", () => {
  it("labels its buttons through i18n", async () => {
    vi.mocked(message).mockResolvedValueOnce(CANCEL);
    await promptSaveForDirtyDocument(ctx("a", "/a.md"));
    expect(buttonsOfLastDialog()).toEqual({ yes: SAVE, no: DONT_SAVE, cancel: CANCEL });
  });

  it.each([
    [DONT_SAVE, "discarded"],
    [CANCEL, "cancelled"],
    [SAVE, "saved"],
  ])("maps the translated label %s to %s", async (label, action) => {
    vi.mocked(message).mockResolvedValueOnce(label);
    const result = await promptSaveForDirtyDocument(ctx("a", "/a.md"));
    expect(result.action).toBe(action);
  });
});

describe("multi-document save dialog", () => {
  const two = [ctx("a", "/a.md"), ctx("b", "/b.md")];

  it("labels its buttons through i18n", async () => {
    vi.mocked(message).mockResolvedValueOnce(CANCEL);
    await promptSaveForMultipleDocuments(two);
    expect(buttonsOfLastDialog()).toEqual({ yes: SAVE_ALL, no: DONT_SAVE, cancel: CANCEL });
  });

  it("marks an untitled document through i18n, not with an English suffix", async () => {
    vi.mocked(message).mockResolvedValueOnce(CANCEL);
    await promptSaveForMultipleDocuments([ctx("Untitled-1", null), ctx("b", "/b.md")]);
    const text = vi.mocked(message).mock.calls.at(-1)?.[0] as string;
    expect(text).toContain('<dialog:unsavedChanges.newDocEntry|{\\"title\\":\\"Untitled-1\\"}>');
    expect(text).not.toContain("(new)");
  });

  it.each([
    [DONT_SAVE, "discarded-all"],
    [CANCEL, "cancelled"],
    [SAVE_ALL, "saved-all"],
  ])("maps the translated label %s to %s", async (label, action) => {
    vi.mocked(message).mockResolvedValueOnce(label);
    const result = await promptSaveForMultipleDocuments(two);
    expect(result.action).toBe(action);
  });
});

// The dialog reports a click by handing back the clicked button's LABEL, so a
// locale whose labels collide — with each other or with the plugin's
// "Yes"/"No"/"Cancel" sentinels for another role — makes the answer ambiguous.
describe("button labels in every locale", () => {
  const localesDir = join(import.meta.dirname, "../../locales");
  const locales = readdirSync(localesDir).filter((d) => !d.startsWith("_") && !d.includes("."));

  it.each(locales)("%s: labels exist and cannot be mistaken for another button", (locale) => {
    const dialog = JSON.parse(readFileSync(join(localesDir, locale, "dialog.json"), "utf8")) as Record<string, string>;
    const label = (k: string) => dialog[`unsavedChanges.${k}`];
    for (const yesKey of ["buttonSave", "buttonSaveAll"]) {
      const roles = { yes: label(yesKey), no: label("buttonDontSave"), cancel: label("buttonCancel") };
      for (const value of Object.values(roles)) expect(typeof value === "string" && value.trim() !== "").toBe(true);
      expect(new Set(Object.values(roles)).size).toBe(3);
      expect(["No", "Cancel"]).not.toContain(roles.yes);
      expect(["Yes", "Cancel"]).not.toContain(roles.no);
      expect(["Yes", "No"]).not.toContain(roles.cancel);
    }
  });
});
