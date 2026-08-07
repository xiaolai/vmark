/**
 * Purpose: pin the global i18n mock to the parts of i18next's contract that
 *   components actually depend on.
 *
 * `setup.ts` mocks `react-i18next` and `@/i18n` so component tests can assert
 * against real English text. Where the mock diverges from i18next, that promise
 * quietly stops holding — and the failure is invisible, because `t()` returns a
 * plausible-looking string (the raw key) instead of throwing.
 *
 * Each block below corresponds to a divergence that existed:
 *
 *  - **Namespace arrays.** `useTranslation(["dialog", "common"])` is shipped
 *    usage (`PdfExportPage`, `AboutSettings`). The mock took a single string,
 *    so the array became an object key — the literal `"dialog,common"` — every
 *    lookup missed, and those pages' tests asserted against key names while
 *    believing they asserted against English.
 *  - **Plural rules.** `count === 1` disagrees with English at `-1`, where
 *    `Intl.PluralRules("en")` selects `one`.
 *  - **`on`/`off`.** They discarded their arguments, so a node view's
 *    subscription — and more importantly its UNSUBSCRIBE on teardown — could
 *    not be observed. A leaked listener is invisible against a registry that
 *    never held it.
 *
 * @coordinates-with src/test/setup.ts — the mock this pins
 * @module test/i18nMockContract
 */
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { nsList, resolveKey } from "./i18nResolve";

/**
 * Resolve through the same path the mock uses, WITHOUT calling a hook.
 *
 * The first version of this helper called `useTranslation` directly, which is
 * a `react-hooks/rules-of-hooks` error: a bare function that is neither a
 * component nor a hook. The tempting fix was an eslint-disable — telling the
 * linter it is not really a hook, while leaving every reader to guess. The
 * resolver now lives in its own module, so this is an ordinary function call.
 * The hook WIRING is still covered, by `renderHook` at the bottom.
 */
function t(ns: string | readonly string[], key: string, opts?: Record<string, unknown>) {
  return resolveKey(key, nsList(ns), opts);
}

/** Curried form, so the existing cases read unchanged. */
function tFor(ns?: string | readonly string[]) {
  return (key: string, opts?: Record<string, unknown>) => t(ns ?? "common", key, opts);
}

describe("namespace resolution", () => {
  it("resolves a key from EACH namespace when given an array", () => {
    const t = tFor(["dialog", "common"]);
    // dialog-only key, and common-only key, through one `t`.
    expect(t("unsavedChanges.title")).toBe("Unsaved Changes");
    expect(t("emptyState.title")).toBe("VMark");
  });

  it("does not echo the raw key for an array namespace", () => {
    // The exact symptom of the old bug: `localeMap["dialog,common"]` was
    // undefined, so every key fell through to the echo branch.
    const t = tFor(["dialog", "common"]);
    expect(t("unsavedChanges.title")).not.toBe("unsavedChanges.title");
  });

  it("prefers the FIRST namespace that has the key", () => {
    // i18next's fallback order. Reversing the list must not change a key that
    // only one namespace defines, but the order must be honoured when both do.
    expect(tFor(["dialog", "common"])("emptyState.title")).toBe("VMark");
    expect(tFor(["common", "dialog"])("unsavedChanges.title")).toBe("Unsaved Changes");
  });

  it("an explicit ns: prefix overrides the hook's namespaces", () => {
    const t = tFor(["common"]);
    expect(t("dialog:unsavedChanges.title")).toBe("Unsaved Changes");
  });

  it("a genuinely missing key still echoes, and defaultValue still wins", () => {
    const t = tFor(["common"]);
    expect(t("no.such.key.anywhere")).toBe("no.such.key.anywhere");
    expect(t("no.such.key.anywhere", { defaultValue: "fallback" })).toBe("fallback");
  });
});

describe("the react-i18next mock is wired to that resolver", () => {
  // Through a real renderer, so the hook is called from a legitimate site and
  // the assertions above are not merely testing a module nothing consumes.
  it("useTranslation(array) yields a t() that resolves across the namespaces", () => {
    const { result } = renderHook(() => useTranslation(["dialog", "common"]));
    expect(result.current.t("unsavedChanges.title")).toBe("Unsaved Changes");
    expect(result.current.t("emptyState.title")).toBe("VMark");
  });

  it("useTranslation(string) still works", () => {
    const { result } = renderHook(() => useTranslation("dialog"));
    expect(result.current.t("unsavedChanges.title")).toBe("Unsaved Changes");
  });
});

describe("plural selection follows Intl.PluralRules('en')", () => {
  const t = () => tFor(["dialog"]);

  it.each([
    [1, "document:"],
    [2, "documents:"],
    [0, "documents:"],
  ])("count=%i selects the %s form", (count, expected) => {
    expect(t()("unsavedChanges.multiple", { count, list: "a" })).toContain(expected);
  });

  it("count=-1 selects ONE, as English requires", () => {
    // `count === 1` returned the plural form here. No caller passes a negative
    // count today, so this pins a latent divergence rather than a live bug —
    // but the rule is now Intl's, so the question cannot come back.
    expect(new Intl.PluralRules("en").select(-1)).toBe("one");
    expect(t()("unsavedChanges.multiple", { count: -1, list: "a" })).toContain("document:");
  });

  it("interpolates the count into the selected form", () => {
    expect(t()("unsavedChanges.multiple", { count: 3, list: "x" })).toContain("3");
  });
});

describe("the i18n singleton is a real event emitter", () => {
  it("records a listener, dispatches to it, and releases it on off()", () => {
    const seen: string[] = [];
    const cb = (lng: unknown) => seen.push(String(lng));

    i18n.on("languageChanged", cb);
    expect(i18n.__listenerCount("languageChanged")).toBe(1);

    i18n.changeLanguage("zh");
    expect(seen).toEqual(["zh"]);
    expect(i18n.language).toBe("zh");

    i18n.off("languageChanged", cb);
    expect(i18n.__listenerCount("languageChanged")).toBe(0);

    i18n.changeLanguage("en");
    expect(seen, "an unsubscribed listener must not fire").toEqual(["zh"]);
  });

  it("makes a LEAKED subscription observable — the case that motivated this", () => {
    // With no-op `on`/`off`, a component that forgot to unsubscribe looked
    // identical to one that did. Now the count says which.
    const before = i18n.__listenerCount("languageChanged");
    const leak = vi.fn();
    i18n.on("languageChanged", leak);
    expect(i18n.__listenerCount("languageChanged")).toBe(before + 1);
    i18n.off("languageChanged", leak);
    expect(i18n.__listenerCount("languageChanged")).toBe(before);
  });
});
