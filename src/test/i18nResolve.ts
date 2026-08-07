/**
 * Purpose: the i18n key resolver behind the global `react-i18next` mock.
 *
 * Lifted out of `src/test/setup.ts` because it is LOGIC, and logic in a setup
 * file can only be tested through the shape that consumes it — which here meant
 * calling `useTranslation` from a bare helper and tripping
 * `react-hooks/rules-of-hooks`. Silencing that lint would have been a way of
 * saying "this isn't really a hook" to the linter instead of to the reader.
 * A module can just be imported and asserted on.
 *
 * `setup.ts` keeps the wiring (`vi.mock` calls); this keeps the behaviour.
 *
 * @coordinates-with src/test/setup.ts — the mocks that consume this
 * @coordinates-with src/test/i18nMockContract.test.ts — the assertions
 * @module test/i18nResolve
 */
import { localeMap } from "./i18nNamespaces";

function applyInterpolation(template: string, opts?: Record<string, unknown>): string {
  if (!opts) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const val = opts[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

/** English plural category, by the same rules i18next uses (`Intl.PluralRules`).
 *
 *  This was `count === 1 ? "one" : "other"`, which disagrees with English for
 *  **-1**: `Intl.PluralRules("en").select(-1)` is `"one"`. No caller passes a
 *  negative count today, so this fixes a latent divergence rather than an
 *  observed bug — but a hand-written rule that merely happens to be unreached
 *  is not the same as a correct one, and delegating to `Intl` removes the
 *  question permanently. */
const EN_PLURAL = new Intl.PluralRules("en");

/**
 * Look one key up in one namespace. FLAT ONLY — there is no nested fallback.
 *
 * There used to be a `walkNestedKey` dot-path walker here, kept "as a fallback
 * only". It was unreachable: `src/locales/__tests__/localeShape.test.ts` asserts
 * that no locale bundle — across all nine-plus locales — contains a nested
 * object anywhere, and that gate runs in `check:all`. So the branch could not
 * be entered, while implementing precisely the resolution AGENTS.md bans
 * ("Locale bundles are FLAT — no nested objects, ever").
 *
 * Deleting it also removes the hazard its own comment described. Real i18next
 * resolves nested-BEFORE-flat while this mock resolved flat-before-nested, and
 * that disagreement is what once let a shadowed translation pass tests and ship
 * as English. With no nested branch at all, the two cannot disagree.
 */
function lookup(namespace: string, localKey: string): string | undefined {
  const value = (localeMap[namespace] ?? {})[localKey];
  return typeof value === "string" ? value : undefined;
}

/**
 * Resolve a namespaced key like "editor:popup.link.url.placeholder"
 * or a plain key like "popup.link.url.placeholder" against the locale map.
 *
 * `namespaces` is a LIST because `useTranslation` accepts one:
 * `useTranslation(["dialog", "common"])` is real, shipped usage
 * (`PdfExportPage`, `AboutSettings`). The previous signature took a single
 * string, so an array arrived here and was used as an object key — coercing to
 * the literal `"dialog,common"`, missing every lookup, and making `t()` echo
 * raw key names. Those pages' tests were asserting against key strings while
 * believing they asserted against English.
 */
export function resolveKey(key: string, namespaces: string[], opts?: Record<string, unknown>): string {
  // An explicit `ns:` prefix wins over the hook's namespace list.
  let candidates = namespaces.length ? namespaces : ["common"];
  let localKey = key;
  if (key.includes(":")) {
    const colonIdx = key.indexOf(":");
    candidates = [key.slice(0, colonIdx)];
    localKey = key.slice(colonIdx + 1);
  }

  // i18next v4 plural resolution: a numeric count selects the _one/_other
  // suffixed key before the bare key (audit 20260612 H16).
  if (typeof opts?.count === "number") {
    const suffixed = `${localKey}_${EN_PLURAL.select(opts.count)}`;
    for (const ns of candidates) {
      const plural = lookup(ns, suffixed);
      if (plural !== undefined) return applyInterpolation(plural, opts);
    }
  }

  // First namespace that has the key wins — i18next's fallback order.
  for (const ns of candidates) {
    const template = lookup(ns, localKey);
    if (template !== undefined) return applyInterpolation(template, opts);
  }

  // A missing key honors opts.defaultValue before echoing the key —
  // matching real i18next behavior.
  const fallback =
    typeof opts?.defaultValue === "string" ? (opts.defaultValue as string) : key;
  return applyInterpolation(fallback, opts);
}

/** Normalize `useTranslation`'s argument to the namespace list i18next uses. */
export function nsList(ns?: string | readonly string[]): string[] {
  if (Array.isArray(ns)) return [...ns];
  return [(ns as string | undefined) ?? "common"];
}
