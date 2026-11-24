// WI-RA20.4 — shortcut import problems are shown in the UI language. The
// store used to return English sentences ("Unknown shortcut: x"), which the
// toast displayed verbatim under a translated title. It now returns codes
// with parameters, and the settings page translates them.
//
// The app tier's i18n mock resolves English only, so "translated" is pinned
// by spying `i18n.t`: every line must come out of a translation key with its
// parameters, never a sentence built in code.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import i18n from "@/i18n";

vi.mock("@/services/dialogs/confirmAction", () => ({ confirmAction: vi.fn() }));

const toastError = vi.hoisted(() => vi.fn());
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { error: toastError },
}));

import { ShortcutsSettings } from "./ShortcutsSettings";
import { useShortcutsStore } from "@/stores/settingsStore";

const KEYS = [
  "shortcuts.importError.invalidFormat",
  "shortcuts.importError.invalidKey",
  "shortcuts.importError.unknownShortcut",
  "shortcuts.importError.parse",
];

async function importFile(container: HTMLElement, text: string): Promise<void> {
  const input = container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("no file input");
  fireEvent.change(input, { target: { files: [new File([text], "shortcuts.json", { type: "application/json" })] } });
}

async function descriptionLines(): Promise<string[]> {
  await vi.waitFor(() => expect(toastError).toHaveBeenCalledOnce());
  const [, opts] = toastError.mock.calls[0] as [string, { description: string }];
  return opts.description.split("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  useShortcutsStore.setState({ customBindings: {} });
  // Marker translation: "⟦key|param⟧" shows which key and parameter made the line.
  vi.spyOn(i18n, "t").mockImplementation(((key: string, opts?: Record<string, unknown>) => {
    const param = opts?.id ?? opts?.detail;
    return param === undefined ? `⟦${key}⟧` : `⟦${key}|${String(param)}⟧`;
  }) as unknown as typeof i18n.t);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shortcut import errors are translated at the display site", () => {
  it("renders invalid-key and unknown-shortcut problems from keys, keeping the ids", async () => {
    const { container } = render(<ShortcutsSettings />);
    await importFile(container, JSON.stringify({ customBindings: { bold: 42, noSuchShortcut: "Mod-k" } }));

    expect(await descriptionLines()).toEqual([
      "⟦settings:shortcuts.importError.invalidKey|bold⟧",
      "⟦settings:shortcuts.importError.unknownShortcut|noSuchShortcut⟧",
    ]);
  });

  it("renders a file that is not a shortcut config from its key", async () => {
    const { container } = render(<ShortcutsSettings />);
    await importFile(container, JSON.stringify({ something: "else" }));

    expect(await descriptionLines()).toEqual(["⟦settings:shortcuts.importError.invalidFormat⟧"]);
  });

  it("renders a file that is not JSON from its key, with the parser's detail", async () => {
    const { container } = render(<ShortcutsSettings />);
    await importFile(container, "{ not json");

    const [line] = await descriptionLines();
    expect(line).toMatch(/^⟦settings:shortcuts\.importError\.parse\|.+⟧$/);
  });

  it("has every message translated, with its placeholder, in every locale", () => {
    const localesDir = path.resolve(import.meta.dirname, "../../locales");
    const locales = readdirSync(localesDir).filter((name) => /^[a-z]{2}(-[A-Z]{2})?$/.test(name));
    expect(locales.length).toBeGreaterThanOrEqual(10);
    const english = JSON.parse(readFileSync(path.join(localesDir, "en", "settings.json"), "utf8")) as Record<string, string>;
    for (const locale of locales) {
      const bundle = JSON.parse(readFileSync(path.join(localesDir, locale, "settings.json"), "utf8")) as Record<string, string>;
      for (const key of KEYS) {
        const value = bundle[key];
        expect(value, `${locale} ${key}`).toMatch(/\S/);
        for (const placeholder of english[key]?.match(/\{\{\w+\}\}/g) ?? []) {
          expect(value, `${locale} ${key}`).toContain(placeholder);
        }
      }
    }
  });
});
