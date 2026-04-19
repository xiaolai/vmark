import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveInitialLanguage, SUPPORTED_LOCALES } from "./localeDetect";

type NavigatorLike = {
  language?: string;
  languages?: readonly string[];
};

function withNavigator(stub: NavigatorLike, run: () => void) {
  const original = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", {
    value: stub,
    configurable: true,
    writable: true,
  });
  try {
    run();
  } finally {
    Object.defineProperty(globalThis, "navigator", {
      value: original,
      configurable: true,
      writable: true,
    });
  }
}

describe("resolveInitialLanguage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an exact English match", () => {
    withNavigator({ language: "en-US" }, () => {
      expect(resolveInitialLanguage()).toBe("en");
    });
  });

  it("maps zh-CN directly", () => {
    withNavigator({ language: "zh-CN" }, () => {
      expect(resolveInitialLanguage()).toBe("zh-CN");
    });
  });

  it("routes Simplified Chinese variants to zh-CN", () => {
    withNavigator({ language: "zh-Hans-SG" }, () => {
      expect(resolveInitialLanguage()).toBe("zh-CN");
    });
    withNavigator({ language: "zh-SG" }, () => {
      expect(resolveInitialLanguage()).toBe("zh-CN");
    });
  });

  it("routes Traditional Chinese variants to zh-TW", () => {
    withNavigator({ language: "zh-TW" }, () => {
      expect(resolveInitialLanguage()).toBe("zh-TW");
    });
    withNavigator({ language: "zh-Hant-HK" }, () => {
      expect(resolveInitialLanguage()).toBe("zh-TW");
    });
    withNavigator({ language: "zh-HK" }, () => {
      expect(resolveInitialLanguage()).toBe("zh-TW");
    });
  });

  it("routes all Portuguese variants to pt-BR", () => {
    withNavigator({ language: "pt-PT" }, () => {
      expect(resolveInitialLanguage()).toBe("pt-BR");
    });
    withNavigator({ language: "pt" }, () => {
      expect(resolveInitialLanguage()).toBe("pt-BR");
    });
  });

  it("matches base-language codes when only the region differs", () => {
    withNavigator({ language: "fr-CA" }, () => {
      expect(resolveInitialLanguage()).toBe("fr");
    });
    withNavigator({ language: "de-AT" }, () => {
      expect(resolveInitialLanguage()).toBe("de");
    });
  });

  it("walks navigator.languages until it finds a supported one", () => {
    withNavigator(
      { language: "ru-RU", languages: ["ru-RU", "xx-YY", "ja-JP"] },
      () => {
        expect(resolveInitialLanguage()).toBe("ja");
      }
    );
  });

  it("falls back to English for unsupported locales", () => {
    withNavigator({ language: "ru-RU" }, () => {
      expect(resolveInitialLanguage()).toBe("en");
    });
    withNavigator({ language: "vi-VN" }, () => {
      expect(resolveInitialLanguage()).toBe("en");
    });
  });

  it("handles missing navigator.language", () => {
    withNavigator({}, () => {
      expect(resolveInitialLanguage()).toBe("en");
    });
  });

  it("handles mixed case in tags", () => {
    withNavigator({ language: "zh-hans-cn" }, () => {
      expect(resolveInitialLanguage()).toBe("zh-CN");
    });
    withNavigator({ language: "ZH-TW" }, () => {
      expect(resolveInitialLanguage()).toBe("zh-TW");
    });
  });

  it("never returns an unsupported code", () => {
    const candidates = ["en", "zh-CN", "zh-TW", "ja", "ko", "de", "es", "fr", "it", "pt-BR"];
    for (const locale of candidates) {
      withNavigator({ language: locale }, () => {
        expect(SUPPORTED_LOCALES).toContain(resolveInitialLanguage());
      });
    }
  });
});
