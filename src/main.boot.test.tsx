// WI-RA10B.10 — startup overlaps the secure-storage IPCs with the synchronous
// setup, and still loads App only once the secure-storage cache is filled.
//
// The bootstrap runs for real: secure storage, the format registry and the
// plugin host-settings binding. The boundaries are the Tauri store plugin
// (held pending, so the test decides when secure storage is ready) and
// react-dom's root. App arrives through the loader the entry passes in, which
// is where "only after the cache" is observable: at the moment App is loaded,
// the real secure-storage cache must already hold the saved providers — App's
// AI provider store hydrates from that cache as it evaluates.
import { describe, it, expect, vi } from "vitest";

const SECURE_KEY = "vmark-ai-providers";
const SAVED_PROVIDERS = JSON.stringify({
  state: { activeProvider: "ollama-api", restProviders: [] },
  version: 2,
});

const boot = vi.hoisted(() => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release, storeReads: [] as string[], renders: 0 };
});

vi.mock("@tauri-apps/plugin-store", () => ({
  getStore: vi.fn(() =>
    Promise.resolve({
      get: vi.fn(async (key: string) => {
        boot.storeReads.push(key);
        await boot.ready;
        return key === SECURE_KEY ? SAVED_PROVIDERS : null;
      }),
      set: vi.fn(() => Promise.resolve()),
      save: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    }),
  ),
}));
vi.mock("react-dom/client", () => ({
  default: {
    createRoot: () => ({
      render: () => {
        boot.renders += 1;
      },
    }),
  },
}));

import { bootstrap } from "./bootstrap";
import { createSecureStorage } from "@/services/secrets/secureStorage";
import { useSettingsStore } from "@/stores/settingsStore";
import { hostSettings } from "@/plugins/shared/hostSettings";
import { getFormatById } from "@/lib/formats/registry";
import { invoke } from "@tauri-apps/api/core";
import { offersFullThemeCatalog } from "@/services/theme/nativeThemeCapability";

describe("bootstrap order", () => {
  it("runs the synchronous setup while secure storage loads, and loads App only after it has", async () => {
    useSettingsStore.setState((s) => ({ general: { ...s.general, tabSize: 7 } }));
    expect(hostSettings.tabSize()).not.toBe(7);
    expect(getFormatById("yaml")).toBeUndefined();
    document.body.appendChild(Object.assign(document.createElement("div"), { id: "root" }));

    const cacheWhenAppLoaded: Array<string | null> = [];
    const loadApp = vi.fn(async () => {
      cacheWhenAppLoaded.push(await createSecureStorage().getItem(SECURE_KEY));
      return { default: () => null };
    });

    const done = bootstrap(loadApp);

    // Secure storage is in flight and held; the synchronous setup has run.
    await vi.waitFor(() => expect(boot.storeReads).toEqual([SECURE_KEY]));
    expect(hostSettings.tabSize()).toBe(7);
    expect(getFormatById("yaml")).toBeDefined();
    expect(getFormatById("markdown")).toBeDefined();
    expect(loadApp).not.toHaveBeenCalled();
    expect(boot.renders).toBe(0);

    boot.release();
    await done;

    expect(loadApp).toHaveBeenCalledTimes(1);
    expect(cacheWhenAppLoaded).toEqual([SAVED_PROVIDERS]);
    expect(boot.renders).toBe(1);
  });

  // #1606: a Windows 11 window must know it can render the full catalog BEFORE
  // App's first render, or a Sepia pick paints as White and then switches.
  it("loads App only after the native theme capability has arrived", async () => {
    let answer!: (reply: unknown) => void;
    vi.mocked(invoke).mockImplementation((command: string) =>
      command === "native_theme_capabilities"
        ? new Promise((resolve) => {
            answer = resolve;
          })
        : Promise.resolve(undefined),
    );
    const fullCatalogWhenAppLoaded: boolean[] = [];
    const loadApp = vi.fn(async () => {
      fullCatalogWhenAppLoaded.push(offersFullThemeCatalog());
      return { default: () => null };
    });

    const done = bootstrap(loadApp);
    await vi.waitFor(() => expect(answer).toBeTypeOf("function"));
    await Promise.resolve();
    expect(loadApp).not.toHaveBeenCalled();

    answer({ themedCaption: true });
    await done;

    expect(fullCatalogWhenAppLoaded).toEqual([true]);
  });
});
