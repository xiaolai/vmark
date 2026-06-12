import { describe, it, expect, vi, beforeEach } from "vitest";

// The global test setup mocks @/i18n for all other tests.
// This file tests the real i18n module, so we unmock it here.
vi.unmock("@/i18n");

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      general: { language: "en" },
    }),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

describe("i18n initialization", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("initializes with language from settings", async () => {
    const { default: i18n } = await import("./i18n");
    expect(i18n.language).toBe("en");
  });

  it("resolves plural keys via v4 _one/_other suffixes (audit H16)", async () => {
    // The legacy `_plural` suffix is dead under i18next v25 — these keys
    // silently fell back to the singular form for every count.
    const { default: i18n } = await import("./i18n");
    await i18n.loadNamespaces("dialog");
    const one = i18n.t("dialog:windowClose.pinnedPrompt", { count: 1 });
    const many = i18n.t("dialog:windowClose.pinnedPrompt", { count: 3 });
    expect(one).toContain("1 pinned tab.");
    expect(many).toContain("3 pinned tabs.");
    expect(
      i18n.t("dialog:unsavedChanges.newDocsHint", { count: 2 })
    ).toContain("2 new documents");
  });

  it("has common as default namespace", async () => {
    const { default: i18n } = await import("./i18n");
    expect(i18n.options.defaultNS).toBe("common");
  });

  it("uses currentOnly load strategy", async () => {
    const { default: i18n } = await import("./i18n");
    expect(i18n.options.load).toBe("currentOnly");
  });

  it("sets document.documentElement.lang on language change", async () => {
    const { default: i18n } = await import("./i18n");
    await i18n.changeLanguage("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    // Revert
    await i18n.changeLanguage("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("falls back to zh-CN then en for zh-TW missing keys", async () => {
    const { default: i18n } = await import("./i18n");
    // zh-TW has no files, should fall back through the chain
    const fallback = i18n.options.fallbackLng;
    expect(fallback).toHaveProperty("zh-TW");
    expect((fallback as Record<string, string[]>)["zh-TW"]).toEqual(["zh-CN", "en"]);
  });

  it("falls back to en for pt-BR missing keys", async () => {
    const { default: i18n } = await import("./i18n");
    const fallback = i18n.options.fallbackLng;
    expect(fallback).toHaveProperty("pt-BR");
    expect((fallback as Record<string, string[]>)["pt-BR"]).toEqual(["en"]);
  });
});
