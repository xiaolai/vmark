// @vitest-environment node
// WI-RA14D.1 — on import, startup menu sync sets the Rust locale and rebuilds the
// native menu when the saved language is not English, and a failure is logged
// instead of escaping as an unhandled rejection.
// #1720 — Rust builds the launch menu with DEFAULT accelerators, so saved custom
// shortcuts must reach it at startup in every locale, from the launch
// window each time a `main` webview initializes, and nothing is sent when
// there is nothing to change.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

const menu = vi.hoisted(() => ({
  rebuildNativeMenu: vi.fn<() => Promise<void>>(),
  menuSyncWarn: vi.fn(),
  windowLabel: "main",
  windowThrows: null as Error | null,
}));

// The rebuild pipeline has its own suite (rebuildNativeMenu.test.ts).
vi.mock("@/services/menu/rebuildNativeMenu", () => ({
  rebuildNativeMenu: menu.rebuildNativeMenu,
}));
vi.mock("@/utils/debug", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/debug")>()),
  menuSyncWarn: menu.menuSyncWarn,
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => {
    if (menu.windowThrows) throw menu.windowThrows;
    return { label: menu.windowLabel };
  },
}));

const invokeMock = vi.mocked(invoke);

interface Saved {
  language: string;
  customBindings?: unknown;
  windowLabel?: string;
}

/**
 * Seed what a previous session persisted, then import the module with a fresh
 * module graph — so the stores hydrate from storage exactly as at launch.
 */
async function launchWith({ language, customBindings, windowLabel = "main" }: Saved): Promise<void> {
  vi.resetModules();
  localStorage.clear();
  menu.windowLabel = windowLabel;
  localStorage.setItem(
    "vmark-settings",
    JSON.stringify({ state: { general: { language } }, version: 2 }),
  );
  if (customBindings !== undefined) {
    localStorage.setItem(
      "vmark-shortcuts",
      JSON.stringify({ state: { customBindings, version: 1 }, version: 0 }),
    );
  }
  await import("./startupMenuSync");
}

/** Import the module fresh, with `language` saved and no custom shortcuts. */
function loadWithLanguage(language: string): Promise<void> {
  return launchWith({ language });
}

/** Give the fire-and-forget startup promise chain time to run to completion. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  menu.rebuildNativeMenu.mockReset();
  menu.rebuildNativeMenu.mockResolvedValue(undefined);
  menu.menuSyncWarn.mockReset();
  menu.windowThrows = null;
});

describe("startupMenuSync", () => {
  it("leaves the English menu alone", async () => {
    await loadWithLanguage("en");
    await settle();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(menu.rebuildNativeMenu).not.toHaveBeenCalled();
  });

  it("treats an empty saved language as nothing to sync", async () => {
    await loadWithLanguage("");
    await settle();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(menu.rebuildNativeMenu).not.toHaveBeenCalled();
  });

  it.each(["zh-CN", "ja", "de"])(
    "sets the Rust locale to %s first, then rebuilds the menu",
    async (language) => {
      await loadWithLanguage(language);
      await vi.waitFor(() => expect(menu.rebuildNativeMenu).toHaveBeenCalledTimes(1));
      expect(invokeMock).toHaveBeenCalledWith("set_locale", { locale: language });
      expect(invokeMock.mock.invocationCallOrder[0]).toBeLessThan(
        menu.rebuildNativeMenu.mock.invocationCallOrder[0],
      );
    },
  );

  it("does not rebuild when setting the locale fails, and logs why", async () => {
    const failure = new Error("unknown locale");
    invokeMock.mockRejectedValue(failure);
    await loadWithLanguage("zh-CN");

    await vi.waitFor(() =>
      expect(menu.menuSyncWarn).toHaveBeenCalledWith("rebuild failed:", failure),
    );
    expect(menu.rebuildNativeMenu).not.toHaveBeenCalled();
  });

  it("logs a failed rebuild", async () => {
    const failure = new Error("rebuild_menu failed");
    menu.rebuildNativeMenu.mockRejectedValue(failure);
    await loadWithLanguage("ja");

    await vi.waitFor(() =>
      expect(menu.menuSyncWarn).toHaveBeenCalledWith("rebuild failed:", failure),
    );
  });

  describe("custom shortcuts (#1720)", () => {
    it.each(["en", ""])(
      "rebuilds the menu with the saved bindings when the language is %j",
      async (language) => {
        await launchWith({ language, customBindings: { focusMode: "F12" } });
        await vi.waitFor(() => expect(menu.rebuildNativeMenu).toHaveBeenCalledTimes(1));

        // The rebuild reads the hydrated store; the binding must be in it.
        const { useShortcutsStore } = await import("@/stores/settingsStore");
        expect(useShortcutsStore.getState().getShortcut("focusMode")).toBe("F12");
        expect(invokeMock).not.toHaveBeenCalledWith("set_locale", expect.anything());
      },
    );

    it("treats a deliberate unbinding as a customization", async () => {
      await launchWith({ language: "en", customBindings: { focusMode: "" } });
      await vi.waitFor(() => expect(menu.rebuildNativeMenu).toHaveBeenCalledTimes(1));
    });

    it("rebuilds once, after the locale, when a non-English user has bindings", async () => {
      await launchWith({ language: "ja", customBindings: { focusMode: "F12" } });
      await vi.waitFor(() => expect(menu.rebuildNativeMenu).toHaveBeenCalledTimes(1));
      await settle();

      expect(menu.rebuildNativeMenu).toHaveBeenCalledTimes(1);
      expect(invokeMock).toHaveBeenCalledTimes(1);
      expect(invokeMock).toHaveBeenCalledWith("set_locale", { locale: "ja" });
      expect(invokeMock.mock.invocationCallOrder[0]).toBeLessThan(
        menu.rebuildNativeMenu.mock.invocationCallOrder[0],
      );
    });

    it("sends nothing for an English user with an empty binding map", async () => {
      await launchWith({ language: "en", customBindings: {} });
      await settle();
      expect(invokeMock).not.toHaveBeenCalled();
      expect(menu.rebuildNativeMenu).not.toHaveBeenCalled();
    });

    it("does not rebuild for an English user whose only bindings have no menu item", async () => {
      await launchWith({ language: "en", customBindings: { toggleStatusBar: "F9" } });
      await settle();
      expect(menu.rebuildNativeMenu).not.toHaveBeenCalled();
    });

    it.each(["doc-1", "settings"])("does nothing in the %s window", async (windowLabel) => {
      await launchWith({ language: "ja", customBindings: { focusMode: "F12" }, windowLabel });
      await settle();
      expect(invokeMock).not.toHaveBeenCalled();
      expect(menu.rebuildNativeMenu).not.toHaveBeenCalled();
    });

    it("logs a failed rebuild for an English user", async () => {
      const failure = new Error("rebuild_menu failed");
      menu.rebuildNativeMenu.mockRejectedValue(failure);
      await launchWith({ language: "en", customBindings: { focusMode: "F12" } });

      await vi.waitFor(() =>
        expect(menu.menuSyncWarn).toHaveBeenCalledWith("rebuild failed:", failure),
      );
    });

    it("logs, instead of throwing at import, when the saved binding map is malformed", async () => {
      await expect(
        launchWith({ language: "en", customBindings: null }),
      ).resolves.toBeUndefined();

      await vi.waitFor(() =>
        expect(menu.menuSyncWarn).toHaveBeenCalledWith("rebuild failed:", expect.any(TypeError)),
      );
      expect(menu.rebuildNativeMenu).not.toHaveBeenCalled();
    });

    it("still sets a non-English locale when the saved binding map is malformed", async () => {
      menu.rebuildNativeMenu.mockImplementation(async () => {
        const { useShortcutsStore } = await import("@/stores/settingsStore");
        useShortcutsStore.getState().getAllShortcuts();
      });
      await launchWith({ language: "de", customBindings: null });

      await vi.waitFor(() =>
        expect(menu.menuSyncWarn).toHaveBeenCalledWith("rebuild failed:", expect.any(TypeError)),
      );
      expect(invokeMock).toHaveBeenCalledWith("set_locale", { locale: "de" });
    });

    it("logs, instead of throwing at import, when there is no Tauri window", async () => {
      const failure = new Error("no Tauri internals");
      menu.windowThrows = failure;
      await expect(
        launchWith({ language: "ja", customBindings: { focusMode: "F12" } }),
      ).resolves.toBeUndefined();

      await vi.waitFor(() =>
        expect(menu.menuSyncWarn).toHaveBeenCalledWith("rebuild failed:", failure),
      );
      expect(invokeMock).not.toHaveBeenCalled();
    });
  });
});
