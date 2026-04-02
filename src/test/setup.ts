import "@testing-library/jest-dom";
import { vi } from "vitest";

// ---------------------------------------------------------------------------
// react-i18next global mock
// Makes t(key, opts) return the English translation string with interpolations
// applied, so component tests can assert against real English text.
// ---------------------------------------------------------------------------
import commonEn from "../locales/en/common.json";
import menuEn from "../locales/en/menu.json";
import statusbarEn from "../locales/en/statusbar.json";
import sidebarEn from "../locales/en/sidebar.json";
import settingsEn from "../locales/en/settings.json";
import aiEn from "../locales/en/ai.json";
import editorEn from "../locales/en/editor.json";
import dialogEn from "../locales/en/dialog.json";

const localeMap: Record<string, Record<string, unknown>> = {
  common: commonEn as Record<string, unknown>,
  menu: menuEn as Record<string, unknown>,
  statusbar: statusbarEn as Record<string, unknown>,
  sidebar: sidebarEn as Record<string, unknown>,
  settings: settingsEn as Record<string, unknown>,
  ai: aiEn as Record<string, unknown>,
  editor: editorEn as Record<string, unknown>,
  dialog: dialogEn as Record<string, unknown>,
};

function applyInterpolation(template: string, opts?: Record<string, unknown>): string {
  if (!opts) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const val = opts[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

/**
 * Walk a nested object by dot-separated path.
 * Returns the leaf string value or undefined if not found.
 */
function walkNestedKey(obj: Record<string, unknown>, dotKey: string): string | undefined {
  const parts = dotKey.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

/**
 * Resolve a namespaced key like "editor:popup.link.url.placeholder"
 * or a plain key like "popup.link.url.placeholder" against the locale map.
 * Supports nested JSON objects via dot notation.
 */
function resolveKey(key: string, defaultNs: string, opts?: Record<string, unknown>): string {
  let namespace = defaultNs;
  let localKey = key;
  if (key.includes(":")) {
    const colonIdx = key.indexOf(":");
    namespace = key.slice(0, colonIdx);
    localKey = key.slice(colonIdx + 1);
  }
  const dict = localeMap[namespace] ?? {};
  // Try flat lookup first (for flat JSON like statusbar), then nested
  const flatTemplate = (dict as Record<string, unknown>)[localKey];
  const template = typeof flatTemplate === "string"
    ? flatTemplate
    : (walkNestedKey(dict as Record<string, unknown>, localKey) ?? key);
  return applyInterpolation(template, opts);
}

vi.mock("react-i18next", () => ({
  useTranslation: (ns?: string) => {
    const namespace = ns ?? "common";
    const t = (key: string, opts?: Record<string, unknown>) =>
      resolveKey(key, namespace, opts);
    return { t, i18n: { language: "en" } };
  },
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

// Mock the i18n singleton used by non-React (DOM-based) plugin code.
// Plugins call i18n.t("editor:key") using namespace-prefixed keys.
vi.mock("@/i18n", () => {
  const t = (key: string, opts?: Record<string, unknown>) =>
    resolveKey(key, "common", opts);
  return {
    default: { t, language: "en" },
    // Ensure the default export and named exports both work
    __esModule: true,
  };
});

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
  message: vi.fn(),
  ask: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(() => Promise.resolve("")),
  writeText: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(() =>
    Promise.resolve({
      get: vi.fn(() => Promise.resolve(null)),
      set: vi.fn(() => Promise.resolve()),
      save: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    })
  ),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: vi.fn(() => ({
    onDragDropEvent: vi.fn(() => Promise.resolve(() => {})),
  })),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    label: "main",
    isFocused: vi.fn(() => Promise.resolve(true)),
  })),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => {
  const mockUnlisten = vi.fn();
  return {
    getCurrentWebviewWindow: vi.fn(() => ({
      label: "main",
      isFocused: vi.fn(() => Promise.resolve(true)),
      listen: vi.fn(() => Promise.resolve(mockUnlisten)),
      emit: vi.fn(),
      close: vi.fn(),
      onDragDropEvent: vi.fn(() => Promise.resolve(() => {})),
    })),
    WebviewWindow: {
      getByLabel: vi.fn(() => Promise.resolve(null)),
    },
  };
});

vi.mock("@/lib/pty", () => ({
  spawn: vi.fn(() => ({
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  })),
}));

vi.mock("@xterm/xterm", () => {
  const Terminal = vi.fn(() => ({
    loadAddon: vi.fn(),
    open: vi.fn(),
    write: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn(),
    focus: vi.fn(),
    hasSelection: vi.fn(() => false),
    getSelection: vi.fn(() => ""),
    clearSelection: vi.fn(),
    selectAll: vi.fn(),
    attachCustomKeyEventHandler: vi.fn(),
    registerLinkProvider: vi.fn(),
    cols: 80,
    rows: 24,
    options: {},
    unicode: { activeVersion: "6" },
    buffer: { active: { getLine: vi.fn() } },
  }));
  return { Terminal };
});

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(() => ({ fit: vi.fn(), dispose: vi.fn() })),
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn(() => ({
    onContextLoss: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn(() => ({ dispose: vi.fn() })),
}));

vi.mock("@xterm/addon-unicode11", () => ({
  Unicode11Addon: vi.fn(() => ({ dispose: vi.fn() })),
}));

vi.mock("@xterm/addon-search", () => ({
  SearchAddon: vi.fn(() => ({
    findNext: vi.fn(),
    findPrevious: vi.fn(),
    clearDecorations: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock("@xterm/addon-serialize", () => ({
  SerializeAddon: vi.fn(() => ({
    serialize: vi.fn(() => ""),
    dispose: vi.fn(),
  })),
}));

vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn(() => Promise.resolve("/Users/test")),
  appDataDir: vi.fn(() => Promise.resolve("/Users/test/.config")),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
  dirname: vi.fn((path: string) => Promise.resolve(path.split("/").slice(0, -1).join("/") || "/")),
  basename: vi.fn((path: string) => Promise.resolve(path.split("/").pop() || "")),
}));
