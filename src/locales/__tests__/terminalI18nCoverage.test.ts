// @vitest-environment node
// WI-2.3 — Gate against untranslated terminal settings strings (T10).
// WI-TS5.4 — the terminal-scoping locale sweep (terminal.noWorkspaceSession
//   in every statusbar bundle) is guarded here: a locale shipping the English
//   value verbatim fails this file's identical-to-English check.
//
// Six terminal settings strings shipped as verbatim English in all nine
// non-English locales, plus the two WCAG contrast options and one statusbar
// string. Key-presence gates (scripts/check-i18n-keys.ts) cannot see this:
// the keys were all there, carrying English values.
//
// The contract this file encodes: a `terminal.*` value that is byte-identical
// to English is drift, UNLESS it is on the allow-list below with a stated
// reason. The allow-list is checked for staleness in both directions — an
// entry that is no longer identical must be deleted, so improving a
// translation cannot silently leave a dead exemption behind.
import { describe, it, expect } from "vitest";

import enSettings from "../en/settings.json";
import deSettings from "../de/settings.json";
import esSettings from "../es/settings.json";
import frSettings from "../fr/settings.json";
import itSettings from "../it/settings.json";
import jaSettings from "../ja/settings.json";
import koSettings from "../ko/settings.json";
import ptSettings from "../pt-BR/settings.json";
import zhCNSettings from "../zh-CN/settings.json";
import zhTWSettings from "../zh-TW/settings.json";

import enStatusbar from "../en/statusbar.json";
import deStatusbar from "../de/statusbar.json";
import esStatusbar from "../es/statusbar.json";
import frStatusbar from "../fr/statusbar.json";
import itStatusbar from "../it/statusbar.json";
import jaStatusbar from "../ja/statusbar.json";
import koStatusbar from "../ko/statusbar.json";
import ptStatusbar from "../pt-BR/statusbar.json";
import zhCNStatusbar from "../zh-CN/statusbar.json";
import zhTWStatusbar from "../zh-TW/statusbar.json";

type Bundle = Record<string, string>;

const NAMESPACES: Record<string, { en: Bundle; locales: Record<string, Bundle> }> = {
  settings: {
    en: enSettings as Bundle,
    locales: {
      de: deSettings as Bundle,
      es: esSettings as Bundle,
      fr: frSettings as Bundle,
      it: itSettings as Bundle,
      ja: jaSettings as Bundle,
      ko: koSettings as Bundle,
      "pt-BR": ptSettings as Bundle,
      "zh-CN": zhCNSettings as Bundle,
      "zh-TW": zhTWSettings as Bundle,
    },
  },
  statusbar: {
    en: enStatusbar as Bundle,
    locales: {
      de: deStatusbar as Bundle,
      es: esStatusbar as Bundle,
      fr: frStatusbar as Bundle,
      it: itStatusbar as Bundle,
      ja: jaStatusbar as Bundle,
      ko: koStatusbar as Bundle,
      "pt-BR": ptStatusbar as Bundle,
      "zh-CN": zhCNStatusbar as Bundle,
      "zh-TW": zhTWStatusbar as Bundle,
    },
  },
};

/**
 * Values that are legitimately identical to English. Every entry names the
 * locales it applies to and why. Anything not listed here is drift.
 */
const ALLOWED_IDENTICAL: Array<{
  ns: string;
  key: string;
  locales: string[];
  reason: string;
}> = [
  {
    ns: "settings",
    key: "terminal.group.terminal",
    locales: ["de", "es", "fr", "pt-BR"],
    reason: '"Terminal" is the native word in these languages.',
  },
  {
    ns: "settings",
    key: "terminal.shell.label",
    locales: ["de", "fr", "it", "pt-BR", "zh-CN", "zh-TW"],
    reason: '"Shell" is the established loanword; translating it would be less clear.',
  },
  {
    ns: "settings",
    key: "terminal.cursorStyle.block",
    locales: ["de"],
    reason: '"Block" is the German word, and the glyph carries the meaning.',
  },
  {
    ns: "settings",
    key: "terminal.contrast.max",
    locales: ["fr"],
    reason: '"Maximum" is the French word.',
  },
  {
    ns: "settings",
    key: "terminal.lineHeight.normal",
    locales: ["de", "es"],
    reason: '"Normal" is the native word; the numeric prefix carries the rest.',
  },
  {
    ns: "settings",
    key: "terminal.lineHeight.extra",
    locales: ["de", "es", "it"],
    reason: '"Extra" is the native word; the numeric prefix carries the rest.',
  },
  {
    ns: "statusbar",
    key: "terminal.search.results",
    locales: ["de", "es", "fr", "it", "ja", "ko", "pt-BR", "zh-CN", "zh-TW"],
    reason:
      'Pure interpolation ("{{index}} / {{count}}") — there is no word to translate.',
  },
  {
    ns: "statusbar",
    key: "terminal.ariaLabel",
    locales: ["de", "es", "fr", "pt-BR"],
    reason:
      '"Terminal" is the native word in these languages. The other five locales ' +
      "have real words for it (Terminale / ターミナル / 터미널 / 终端 / 終端機) and were " +
      "translated, so their exemptions were deleted rather than left as dead weight.",
  },
];

function isAllowed(ns: string, key: string, locale: string): boolean {
  return ALLOWED_IDENTICAL.some(
    (a) => a.ns === ns && a.key === key && a.locales.includes(locale),
  );
}

/** Every `terminal.*` key in the English bundle for a namespace. */
function terminalKeys(en: Bundle): string[] {
  return Object.keys(en).filter((k) => k.startsWith("terminal."));
}

describe("terminal i18n coverage (T10 / WI-2.3)", () => {
  it("has terminal.* keys to check in both namespaces", () => {
    // Guard against the gate silently passing because a rename emptied it.
    expect(terminalKeys(NAMESPACES.settings.en).length).toBeGreaterThan(40);
    expect(terminalKeys(NAMESPACES.statusbar.en).length).toBeGreaterThan(10);
  });

  it("defines every English terminal.* key in every locale", () => {
    const missing: string[] = [];
    for (const [ns, { en, locales }] of Object.entries(NAMESPACES)) {
      for (const key of terminalKeys(en)) {
        for (const [locale, bundle] of Object.entries(locales)) {
          if (!(key in bundle)) missing.push(`${locale}/${ns}.json: ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("has no terminal.* value left verbatim in English", () => {
    const drift: string[] = [];
    for (const [ns, { en, locales }] of Object.entries(NAMESPACES)) {
      for (const key of terminalKeys(en)) {
        for (const [locale, bundle] of Object.entries(locales)) {
          if (bundle[key] === en[key] && !isAllowed(ns, key, locale)) {
            drift.push(`${locale}/${ns}.json: ${key} = ${JSON.stringify(en[key])}`);
          }
        }
      }
    }
    expect(drift).toEqual([]);
  });

  it("has no stale allow-list entry", () => {
    // An exemption whose value is no longer identical is dead weight; deleting
    // it keeps the list an accurate description of what is untranslatable.
    const stale: string[] = [];
    for (const entry of ALLOWED_IDENTICAL) {
      const ns = NAMESPACES[entry.ns];
      expect(ns, `unknown namespace ${entry.ns}`).toBeDefined();
      for (const locale of entry.locales) {
        const bundle = ns.locales[locale];
        expect(bundle, `unknown locale ${locale}`).toBeDefined();
        if (bundle[entry.key] !== ns.en[entry.key]) {
          stale.push(`${entry.ns}/${entry.key} @ ${locale}`);
        }
      }
    }
    expect(stale).toEqual([]);
  });

  it("keeps every allow-list entry documented", () => {
    for (const entry of ALLOWED_IDENTICAL) {
      expect(entry.reason.length).toBeGreaterThan(10);
      expect(entry.locales.length).toBeGreaterThan(0);
    }
  });

  it("translates the eight strings T10 named", () => {
    // Named explicitly so a future bulk edit cannot regress exactly these.
    const T10_SETTINGS = [
      "terminal.shellIntegration.label",
      "terminal.shellIntegration.description",
      "terminal.scrollback.label",
      "terminal.scrollback.description",
      "terminal.screenReaderMode.label",
      "terminal.screenReaderMode.description",
      "terminal.contrast.aa",
      "terminal.contrast.aaa",
    ];
    const { en, locales } = NAMESPACES.settings;
    for (const key of T10_SETTINGS) {
      for (const [locale, bundle] of Object.entries(locales)) {
        expect(bundle[key], `${locale}/settings.json: ${key}`).not.toBe(en[key]);
      }
    }
    // …plus the one statusbar string (fr only).
    expect(NAMESPACES.statusbar.locales.fr["terminal.maxSessions"]).not.toBe(
      NAMESPACES.statusbar.en["terminal.maxSessions"],
    );
  });
});
