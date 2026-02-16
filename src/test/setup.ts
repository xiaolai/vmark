import "@testing-library/jest-dom";
import { vi } from "vitest";

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

vi.mock("tauri-pty", () => ({
  spawn: vi.fn(() => ({
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
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
