// WI-RA14C.5 — settings persistence, end to end: a setting changed through the
// store's own actions reaches localStorage["vmark-settings"] and survives a
// restart, and an untrusted blob (older build, newer build, corrupt,
// wrong-typed, out of range, another window's write) is repaired, not trusted.
//
// REAL: the settings store with its zustand persist config (version, migrate,
// merge), the migration pipeline, the sanitize / clamp / normalize boundary,
// the section-merging storage wrapper, `useSettingsSync`, and the AI provider
// store with its keychain service — all over jsdom's own localStorage.
// FAKED: `@tauri-apps/api/core` (`invoke`, behind which the keychain lives),
// `@tauri-apps/plugin-store` (the provider store's plain JSON file).
// A RESTART is a fresh module graph (`vi.resetModules()` + dynamic import): the
// store is created again and hydrates from localStorage through the same
// migrate + merge it runs at launch. `persist.rehydrate()` on the live store
// was rejected: resetting its in-memory state first goes through the
// persisting `setState`, which overwrites the very blob a restart must read.
// Left to the real-app journey (e2e/journeys/48-settings-persistence.mjs):
// WebKit's own localStorage, and the CSS a changed setting paints.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { ASYNC_IMPORT_WAIT } from "@/test/waitBudget";

const boundary = vi.hoisted(() => ({
  invoke: vi.fn((command: string, _args?: Record<string, unknown>): Promise<unknown> =>
    Promise.resolve(command === "detect_ai_providers" ? [] : command === "read_env_api_keys" ? {} : null),
  ),
  appStore: new Map<string, string>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: boundary.invoke }));
vi.mock("@tauri-apps/plugin-store", () => ({
  getStore: () =>
    Promise.resolve({
      get: (key: string) => Promise.resolve(boundary.appStore.get(key) ?? null),
      set: (key: string, value: string) => Promise.resolve(void boundary.appStore.set(key, value)),
      save: () => Promise.resolve(),
      delete: (key: string) => Promise.resolve(void boundary.appStore.delete(key)),
    }),
}));

const KEY = "vmark-settings";
type Json = Record<string, unknown>;
type Sections = Record<string, Json>;

/** State as data: what a persisted blob can hold (actions stripped). */
const plain = (value: unknown): Sections => JSON.parse(JSON.stringify(value)) as Sections;
const onDisk = (): { state: Sections; version: number } =>
  JSON.parse(localStorage.getItem(KEY) ?? "null") as { state: Sections; version: number };
/** The persisted schema version this build writes (settingsStore SETTINGS_VERSION). */
const VERSION = 2;
const seed = (state: unknown, version = VERSION) => localStorage.setItem(KEY, JSON.stringify({ state, version }));
/** The persisted blob with one section patched — what another window would write. */
const withSection = (section: string, patch: Json): string => {
  const blob = onDisk();
  return JSON.stringify({ ...blob, state: { ...blob.state, [section]: { ...blob.state[section], ...patch } } });
};

/** One launch: a fresh module graph, so the store is created and hydrated again. */
async function launch() {
  vi.resetModules();
  const { useSettingsStore: settings } = await import("@/stores/settingsStore");
  const { initialState } = await import("@/stores/settingsStore/defaults");
  return { settings, defaults: plain(initialState), live: () => plain(settings.getState()) };
}

/** A launch with `useSettingsSync` mounted, plus "another window wrote this". */
async function launchWithSync() {
  const app = await launch();
  const { useSettingsSync } = await import("@/hooks/useSettingsSync");
  renderHook(() => useSettingsSync());
  const fromOtherWindow = (key: string, newValue: string | null) => {
    const oldValue = localStorage.getItem(key);
    if (newValue === null) localStorage.removeItem(key);
    else localStorage.setItem(key, newValue);
    window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue, storageArea: localStorage }));
  };
  return { ...app, fromOtherWindow };
}

beforeEach(() => {
  localStorage.clear();
  boundary.appStore.clear();
  boundary.invoke.mockClear();
});
afterEach(cleanup);

describe("Tier-0 settings persistence — what a change writes and a restart reads", () => {
  /** Changes in eight sections plus the top-level flag; returns the expected state. */
  async function changeSeveral() {
    const { settings, defaults } = await launch();
    const s = settings.getState();
    const protocols = [...(defaults.advanced.customLinkProtocols as string[]), "zotero"];
    s.updateAppearanceSetting("theme", "night");
    s.updateAppearanceSetting("cjkFont", "思源宋体 Source Han Serif");
    s.updateGeneralSetting("autoSaveInterval", 120);
    s.updateMarkdownSetting("pasteMode", "plain");
    s.updateCJKFormattingSetting("quoteStyle", "corner");
    s.updateTerminalSetting("cursorStyle", "block");
    s.updateAdvancedSetting("customLinkProtocols", protocols);
    s.updateUpdateSetting("skipVersion", "9.9.9");
    s.updateFormatsSetting("externalEditor", "/Applications/文本 编辑.app");
    s.toggleDevSection();
    return {
      ...defaults,
      appearance: { ...defaults.appearance, theme: "night", cjkFont: "思源宋体 Source Han Serif" },
      general: { ...defaults.general, autoSaveInterval: 120 },
      markdown: { ...defaults.markdown, pasteMode: "plain" },
      cjkFormatting: { ...defaults.cjkFormatting, quoteStyle: "corner" },
      terminal: { ...defaults.terminal, cursorStyle: "block" },
      advanced: { ...defaults.advanced, customLinkProtocols: protocols },
      update: { ...defaults.update, skipVersion: "9.9.9" },
      formats: { ...defaults.formats, externalEditor: "/Applications/文本 编辑.app" },
      showDevSection: !defaults.showDevSection,
    };
  }

  it("writes changes under the real key in the versioned envelope, and a restart rehydrates all of them", async () => {
    const expected = await changeSeveral();

    expect(onDisk()).toEqual({ state: expected, version: VERSION });
    // Whole-state equality: every change survived AND everything else is still a default.
    expect((await launch()).live()).toEqual(expected);
  });

  it("rapid repeats persist the last value, and an out-of-range set is clamped in state and on disk", async () => {
    const { settings } = await launch();
    for (let size = 8; size <= 60; size++) settings.getState().updateAppearanceSetting("fontSize", size);
    settings.getState().updateTerminalSetting("scrollback", -5);

    expect(onDisk().state.appearance.fontSize).toBe(48);
    expect(onDisk().state.terminal.scrollback).toBe(100);
    const restarted = (await launch()).live();
    expect([restarted.appearance.fontSize, restarted.terminal.scrollback]).toEqual([48, 100]);
  });

  it("resetSettings restores every default, persists them, and the reset survives a restart", async () => {
    await changeSeveral();
    const { settings, live, defaults } = await launch();

    settings.getState().resetSettings();

    expect(live()).toEqual(defaults);
    expect(onDisk()).toEqual({ state: defaults, version: VERSION });
    expect((await launch()).live()).toEqual(defaults);
  });
});

describe("Tier-0 settings persistence — blobs this build did not write", () => {
  it("migrates a version-0 blob: renamed, relocated and retired keys, rewritten at the current version", async () => {
    seed(
      {
        appearance: { paragraphSpacing: 2, autoHideStatusBar: true, theme: "night" },
        terminal: { inputGate: true, fontSize: 15 },
        advanced: { workspaceRailMode: true, workflowViewer: true, mcpServer: { port: 9999, autoStart: false } },
      },
      0,
    );

    const { live, defaults } = await launch();

    const expected = {
      ...defaults,
      appearance: { ...defaults.appearance, blockSpacing: 2, theme: "night" },
      terminal: { ...defaults.terminal, fontSize: 15 },
      general: { ...defaults.general, workspaceRailMode: true },
      advanced: { ...defaults.advanced, mcpServer: { autoStart: false, autoApproveEdits: false } },
    };
    expect(live()).toEqual(expected);
    expect(onDisk()).toEqual({ state: expected, version: VERSION });
  });

  it("drops a blob written by a newer build instead of merging it", async () => {
    seed({ appearance: { fontSize: 30, theme: "night" }, general: { tabSize: 8 } }, VERSION + 1);

    const { live, defaults } = await launch();

    expect(live()).toEqual(defaults);
  });

  it.each([
    ["not JSON", "{not json"], ["an empty string", ""], ["JSON null", "null"],
    ["a bare number", "42"], ["a bare string", '"settings"'],
    ["a state that is a number", '{"state":42,"version":1}'],
    ["a state that is null", '{"state":null,"version":1}'],
  ])("%s falls back to defaults without throwing, and the next change repairs the key", async (_label, raw) => {
    localStorage.setItem(KEY, raw);

    const { settings, live, defaults } = await launch();

    expect(live()).toEqual(defaults);
    settings.getState().updateGeneralSetting("tabSize", 4);
    expect(onDisk()).toEqual({ state: { ...defaults, general: { ...defaults.general, tabSize: 4 } }, version: VERSION });
  });

  it("drops a wrong-typed section or leaf and keeps its valid siblings", async () => {
    seed({
      appearance: "evil",
      general: 5,
      markdown: ["not", "an", "object"],
      terminal: { fontSize: "15", scrollback: 9000, cursorStyle: 3, shell: "/bin/zsh" },
      advanced: { customLinkProtocols: "obsidian", mcpServer: "nope", developerMode: true },
      update: { lastCheckTimestamp: 1_700_000_000_000, autoCheckEnabled: "yes" },
    });

    const { live, defaults } = await launch();

    expect(live()).toEqual({
      ...defaults,
      terminal: { ...defaults.terminal, scrollback: 9000, shell: "/bin/zsh" },
      advanced: { ...defaults.advanced, developerMode: true },
      update: { ...defaults.update, lastCheckTimestamp: 1_700_000_000_000 },
    });
  });

  it("clamps out-of-range numbers and normalizes unsafe values at hydration", async () => {
    seed({
      appearance: { fontSize: 9999, lineHeight: 0, editorWidth: -40 },
      terminal: { scrollback: 5, panelRatio: -3 },
      general: { autoSaveInterval: 1, coherenceCheckTau: 7, historyMaxAgeDays: 0 },
      browser: { aiSession: "wide-open", aiAllowLoopback: true },
      advanced: { customLinkProtocols: [42, "zotero", null, { scheme: "x" }] },
    });

    const { live, defaults } = await launch();

    expect(live()).toEqual({
      ...defaults,
      appearance: { ...defaults.appearance, fontSize: 48, lineHeight: 1, editorWidth: 0 },
      terminal: { ...defaults.terminal, scrollback: 100, panelRatio: 0.1 },
      general: { ...defaults.general, autoSaveInterval: 5, coherenceCheckTau: 1, historyMaxAgeDays: 1 },
      browser: { ...defaults.browser, aiSession: "sandbox", aiAllowLoopback: true },
      // A current-version list is the user's own: non-strings dropped, no defaults added.
      advanced: { ...defaults.advanced, customLinkProtocols: ["zotero"] },
    });
  });
});

describe("Tier-0 settings persistence — what must never reach localStorage", () => {
  it("sends an API key to the keychain and keeps it out of localStorage and the provider file", async () => {
    await launch();
    const { useAiProviderStore } = await import("@/stores/aiStore");
    const secret = "sk-live-密钥-0123456789";

    useAiProviderStore.getState().updateRestProvider("openai", { apiKey: secret, model: "gpt-tier0" });

    await vi.waitFor(
      () => expect(boundary.appStore.get("vmark-ai-providers")).toContain("gpt-tier0"),
      ASYNC_IMPORT_WAIT,
    );
    expect(boundary.invoke).toHaveBeenCalledWith("set_secret", { key: "apikey.openai", value: secret });
    expect(boundary.appStore.get("vmark-ai-providers")).not.toContain(secret);
    const everything = Object.keys(localStorage).map((key) => `${key}=${localStorage.getItem(key)}`);
    expect(everything.join("\n")).not.toContain(secret);
  });
});

describe("Tier-0 settings persistence — another window's write", () => {
  it("a storage event updates the running store through the same guards as hydration", async () => {
    const { settings, live, defaults, fromOtherWindow } = await launchWithSync();
    settings.getState().updateGeneralSetting("tabSize", 4);
    const theirs = onDisk();
    theirs.state.terminal = { ...theirs.state.terminal, fontSize: 20 };
    theirs.state.appearance = { ...theirs.state.appearance, fontSize: 9999, theme: "night" };

    fromOtherWindow(KEY, JSON.stringify({ ...theirs, state: { ...theirs.state, markdown: "evil" } }));

    expect(live()).toEqual({
      ...defaults,
      general: { ...defaults.general, tabSize: 4 },
      terminal: { ...defaults.terminal, fontSize: 20 },
      appearance: { ...defaults.appearance, fontSize: 48, theme: "night" },
    });
  });

  it("a write from this window keeps a section another window changed since this one last read", async () => {
    const { settings } = await launch();
    settings.getState().updateGeneralSetting("tabSize", 4);
    // No storage event delivered: this window still holds the old terminal section.
    localStorage.setItem(KEY, withSection("terminal", { fontSize: 20 }));

    settings.getState().updateMarkdownSetting("showInvisibles", true);

    const { state } = onDisk();
    expect([state.terminal.fontSize, state.markdown.showInvisibles, state.general.tabSize]).toEqual([20, true, 4]);
  });

  it("ignores a storage event that is not a usable settings blob, and every event once unmounted", async () => {
    const { settings, live, fromOtherWindow } = await launchWithSync();
    settings.getState().updateGeneralSetting("tabSize", 4);
    const before = live();
    const theirs = withSection("general", { tabSize: 8 });

    fromOtherWindow("vmark-recent-files", theirs);
    fromOtherWindow(KEY, "{not json");
    fromOtherWindow(KEY, JSON.stringify({ version: 1 }));
    fromOtherWindow(KEY, null);
    expect(live()).toEqual(before);

    cleanup();
    fromOtherWindow(KEY, theirs);
    expect(live()).toEqual(before);
  });
});
