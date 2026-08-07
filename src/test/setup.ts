import "@testing-library/jest-dom";
import { configure as configureTestingLibrary } from "@testing-library/react";
import { vi } from "vitest";
import React from "react";
import "./localStorageShim";
import { posix } from "node:path";
import { ASYNC_IMPORT_WAIT } from "./waitBudget";

// Suite-wide async-wait budget. Rationale (and the `vi.waitFor` twin, which
// has no global equivalent) live in `./waitBudget`.
configureTestingLibrary({ asyncUtilTimeout: ASYNC_IMPORT_WAIT.timeout });

// vitest-axe matchers (RW-15 / L11) are NOT registered here. axe-core is the
// heaviest import this setup ever pulled, and exactly 5 of ~1,436 app-tier test
// files assert on accessibility — every other file paid for it. The five
// `*.a11y.test.tsx` suites now `import "@/test/axeMatchers"` themselves, which
// extends `expect` at import time just as this did. See that file.

// Provide the build-time __VMARK_VERSION__ define for tests. Production
// gets it from vite.config.ts's `define`; vitest does not run the
// frontend Vite config, so we stub a stable test value here.
vi.stubGlobal("__VMARK_VERSION__", "0.0.0-test");

// NOTE: deliberately NO global ResizeObserver shim. Defining it makes
// mermaid/markmap render code proceed past the ResizeObserver check and then
// hit the *next* missing jsdom API (SVGElement.getBBox), throwing async errors
// that leak across tests far worse than the original fast-fail. Tests that
// genuinely need ResizeObserver (xyflow in WorkflowCanvas) provide their own
// local, callback-firing shim. matchMedia is likewise shimmed per-test.

// react-i18next global mock
// Makes t(key, opts) return the English translation string with interpolations
// applied, so component tests can assert against real English text.
import { nsList, resolveKey } from "./i18nResolve";

vi.mock("react-i18next", () => ({
  useTranslation: (ns?: string | readonly string[]) => {
    const namespaces = nsList(ns);
    const t = (key: string, opts?: Record<string, unknown>) =>
      resolveKey(key, namespaces, opts);
    return { t, i18n: { language: "en" } };
  },
  // `withTranslation(ns)` HOC: injects `t` and `i18n` props into the wrapped
  // component. Mirrors the production behavior just enough for tests that
  // render class components depending on the HOC.
  withTranslation:
    (ns?: string | readonly string[]) =>
    <P extends object>(WrappedComponent: React.ComponentType<P & { t: (key: string, opts?: Record<string, unknown>) => string; i18n: { language: string } }>) => {
      const namespaces = nsList(ns);
      const t = (key: string, opts?: Record<string, unknown>) =>
        resolveKey(key, namespaces, opts);
      const Wrapped = (props: P) =>
        React.createElement(WrappedComponent, { ...props, t, i18n: { language: "en" } } as P & { t: typeof t; i18n: { language: string } });
      Wrapped.displayName = `withTranslation(${WrappedComponent.displayName || WrappedComponent.name || "Component"})`;
      return Wrapped;
    },
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

// Mock the i18n singleton used by non-React (DOM-based) plugin code.
// Plugins call i18n.t("editor:key") using namespace-prefixed keys.
vi.mock("@/i18n", () => {
  const t = (key: string, opts?: Record<string, unknown>) =>
    resolveKey(key, ["common"], opts);

  // A REAL listener registry, not two no-op arrows.
  //
  // `on`/`off` used to discard their arguments, which made three things
  // untestable through the global mock: that a node view subscribes to
  // `languageChanged` at all, that it re-renders when the language changes,
  // and — the one that actually bites — that it UNSUBSCRIBES on teardown. A
  // leaked listener is invisible against a mock that never held it, so the
  // leak ships and the test is green. `src/i18n.ts` itself calls
  // `i18n.on("languageChanged", …)`, so this is the shipped surface.
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const singleton = {
    t,
    language: "en",
    on(event: string, cb: (...args: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
    },
    off(event: string, cb?: (...args: unknown[]) => void) {
      if (!cb) listeners.delete(event);
      else listeners.get(event)?.delete(cb);
    },
    /** Real i18next API, and the only way to dispatch `languageChanged`. */
    changeLanguage(lang: string) {
      singleton.language = lang;
      for (const cb of listeners.get("languageChanged") ?? []) cb(lang);
      return Promise.resolve(t);
    },
    /** Test-only introspection: how many listeners an event currently holds.
     *  Named with a `__` prefix so it cannot be mistaken for i18next API. */
    __listenerCount(event: string) {
      return listeners.get(event)?.size ?? 0;
    },
  };
  return {
    default: singleton,
    // Ensure the default export and named exports both work
    __esModule: true,
  };
});

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  // Resolves by default: the real `invoke` ALWAYS returns a Promise, so a bare
  // `vi.fn()` (undefined) breaks `invoke(...).catch(...)` in tests only.
  invoke: vi.fn(() => Promise.resolve()),
}));

// EVERY async Tauri API mocked here returns a PROMISE, and one of the right
// shape. A bare `vi.fn()` returns `undefined`, which is a lie about the API in
// a way that hides bugs rather than causing them: `await undefined` is
// perfectly happy, so a MISSING `await` in production code looks identical to
// a correct one under test, and a real `.then()/.catch()/.finally()` chain
// throws only here. `invoke` was fixed for exactly this reason and left a
// comment saying so — but the rest of the surface kept the defect, which is
// what "fix the instance, leave the class" looks like.
//
// The resolved VALUES are the empty case of the real return type, not invented
// data: a caller doing `(await readDir(p)).map(...)` or `(await
// readTextFile(p)).split()` should exercise its real path against a mock that
// cannot be `undefined`. Tests needing specific data still set it themselves.
// Pinned by `src/test/tauriMockContract.test.ts`.
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(() => Promise.resolve("")),
  writeTextFile: vi.fn(() => Promise.resolve()),
  exists: vi.fn(() => Promise.resolve(false)),
  mkdir: vi.fn(() => Promise.resolve()),
  readDir: vi.fn(() => Promise.resolve([])),
  remove: vi.fn(() => Promise.resolve()),
  rename: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  // `open`/`save` resolve to null — what the real dialogs return on cancel,
  // and the branch a test that has not stubbed them should be taking.
  open: vi.fn(() => Promise.resolve(null)),
  save: vi.fn(() => Promise.resolve(null)),
  message: vi.fn(() => Promise.resolve()),
  ask: vi.fn(() => Promise.resolve(false)),
  confirm: vi.fn(() => Promise.resolve(false)),
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
  emit: vi.fn(() => Promise.resolve()),
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
      emit: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve()),
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


// Real path semantics, via `node:path`'s POSIX implementation — not a
// hand-rolled approximation of them.
//
// These were `parts.join("/")`, `split("/").slice(0,-1).join("/")` and
// `split("/").pop()`. Each disagrees with the real API precisely at the inputs
// that path-safety code exists to handle: `join("a/","b")` gave `"a//b"`,
// `join("a","../b")` gave `"a/../b"` instead of resolving it, `dirname("/a/b/")`
// gave `"/a/b"` instead of `"/a"`, and `basename("/a/b/")` gave `""` instead of
// `"b"`. So a traversal or trailing-slash guard could be *tested* against a
// normalization the app never receives — the test passes, the guard is wrong,
// and nothing anywhere says so.
//
// macOS is the primary platform (per AGENTS.md), where Tauri's separator is
// POSIX, so `path.posix` is the faithful model rather than a convenient one.
// Pinned by `src/test/tauriMockContract.test.ts`.
vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn(() => Promise.resolve("/Users/test")),
  appDataDir: vi.fn(() => Promise.resolve("/Users/test/.config")),
  join: vi.fn((...parts: string[]) => Promise.resolve(posix.join(...parts))),
  dirname: vi.fn((p: string) => Promise.resolve(posix.dirname(p))),
  basename: vi.fn((p: string) => Promise.resolve(posix.basename(p))),
}));

import "./bindPluginRegistries";
