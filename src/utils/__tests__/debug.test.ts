/**
 * Tests for src/utils/debug.ts — conditional debug loggers.
 *
 * The module evaluates `import.meta.env.DEV` at load time.
 * Vitest sets DEV=true by default, so the default import tests the dev path.
 * For production-mode tests we dynamically re-import with a stubbed env.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// All exported loggers — imported statically (DEV=true in vitest)
import {
  historyLog,
  autoSaveLog,
  terminalLog,
  crashRecoveryLog,
  hotExitLog,
  hotExitWarn,
  fileOpsLog,
  fileOpsWarn,
  mcpAutoStartLog,
  updateCheckerLog,
  aiProviderLog,
  aiProviderWarn,
  geniesLog,
  geniesWarn,
  recentWarn,
  shortcutsWarn,
  imageHandlerWarn,
  smartPasteWarn,
  footnotePopupWarn,
  mediaPopupWarn,
  wysiwygAdapterWarn,
  diagramWarn,
  pasteWarn,
  imageViewWarn,
  sourcePopupWarn,
  actionRegistryWarn,
  markdownCopyWarn,
  wikiLinkPopupWarn,
  historyWarn,
  windowCloseLog,
  windowCloseWarn,
  menuDispatcherLog,
  menuDispatcherWarn,
  watcherWarn,
  exportWarn,
  mcpBridgeLog,
  mdPipelineWarn,
  workspaceWarn,
  titleBarWarn,
  genieWarn,
  imageContextMenuWarn,
  confirmQuitWarn,
  finderFileOpenWarn,
  imageHashWarn,
  imageResizeLog,
  workspaceStorageWarn,
  clipboardWarn,
  renderWarn,
  cleanupWarn,
  listClickFixWarn,
  windowContextError,
  sourceLinkError,
  resolveMediaError,
  sourcePeekError,
  saveError,
  tableActionsError,
  imageHashError,
  wysiwygAdapterError,
} from "../debug";

/* ------------------------------------------------------------------ */
/*  All loggers map                                                    */
/* ------------------------------------------------------------------ */

const allLoggers = {
  historyLog,
  autoSaveLog,
  terminalLog,
  crashRecoveryLog,
  hotExitLog,
  hotExitWarn,
  fileOpsLog,
  fileOpsWarn,
  mcpAutoStartLog,
  updateCheckerLog,
  aiProviderLog,
  aiProviderWarn,
  geniesLog,
  geniesWarn,
  recentWarn,
  shortcutsWarn,
  imageHandlerWarn,
  smartPasteWarn,
  footnotePopupWarn,
  mediaPopupWarn,
  wysiwygAdapterWarn,
  diagramWarn,
  pasteWarn,
  imageViewWarn,
  sourcePopupWarn,
  actionRegistryWarn,
  markdownCopyWarn,
  wikiLinkPopupWarn,
  historyWarn,
  windowCloseLog,
  windowCloseWarn,
  menuDispatcherLog,
  menuDispatcherWarn,
  watcherWarn,
  exportWarn,
  mcpBridgeLog,
  mdPipelineWarn,
  workspaceWarn,
  titleBarWarn,
  genieWarn,
  imageContextMenuWarn,
  confirmQuitWarn,
  finderFileOpenWarn,
  imageHashWarn,
  imageResizeLog,
  workspaceStorageWarn,
  clipboardWarn,
  renderWarn,
  cleanupWarn,
  listClickFixWarn,
  windowContextError,
  sourceLinkError,
  resolveMediaError,
  sourcePeekError,
  saveError,
  tableActionsError,
  imageHashError,
  wysiwygAdapterError,
} as const;

/* ------------------------------------------------------------------ */
/*  Metadata: every logger exists and is a function                    */
/* ------------------------------------------------------------------ */

describe("debug loggers — existence and type", () => {
  it.each(Object.entries(allLoggers))(
    "%s is a function",
    (_name, logger) => {
      expect(typeof logger).toBe("function");
    },
  );

  it("exports all known loggers", () => {
    expect(Object.keys(allLoggers).length).toBeGreaterThanOrEqual(58);
  });
});

/* ------------------------------------------------------------------ */
/*  Naming: each logger uses a unique prefix tag                       */
/* ------------------------------------------------------------------ */

describe("debug loggers — prefix conventions", () => {
  /**
   * Map of logger name -> expected prefix and console method.
   * Loggers ending in "Warn" use console.warn; others use console.log
   * (except menuDispatcherLog and mcpBridgeLog which use console.debug).
   */
  const prefixMap: Record<string, { prefix: string; method: "log" | "warn" | "debug" | "error" }> = {
    historyLog:           { prefix: "[History]",             method: "log" },
    autoSaveLog:          { prefix: "[AutoSave]",            method: "log" },
    terminalLog:          { prefix: "[Terminal]",             method: "log" },
    crashRecoveryLog:     { prefix: "[CrashRecovery]",       method: "log" },
    hotExitLog:           { prefix: "[HotExit]",             method: "log" },
    hotExitWarn:          { prefix: "[HotExit]",             method: "warn" },
    fileOpsLog:           { prefix: "[FileOps]",             method: "log" },
    fileOpsWarn:          { prefix: "[FileOps]",             method: "warn" },
    mcpAutoStartLog:      { prefix: "[MCP]",                 method: "log" },
    updateCheckerLog:     { prefix: "[UpdateChecker]",       method: "log" },
    aiProviderLog:        { prefix: "[AIProvider]",          method: "log" },
    aiProviderWarn:       { prefix: "[AIProvider]",          method: "warn" },
    geniesLog:            { prefix: "[Genies]",              method: "log" },
    geniesWarn:           { prefix: "[Genies]",              method: "warn" },
    recentWarn:           { prefix: "[Recent]",              method: "warn" },
    shortcutsWarn:        { prefix: "[Shortcuts]",           method: "warn" },
    imageHandlerWarn:     { prefix: "[imageHandler]",        method: "warn" },
    smartPasteWarn:       { prefix: "[smartPaste]",          method: "warn" },
    footnotePopupWarn:    { prefix: "[FootnotePopup]",       method: "warn" },
    mediaPopupWarn:       { prefix: "[MediaPopup]",          method: "warn" },
    wysiwygAdapterWarn:   { prefix: "[wysiwygAdapter]",      method: "warn" },
    diagramWarn:          { prefix: "[Diagram]",             method: "warn" },
    pasteWarn:            { prefix: "[Paste]",               method: "warn" },
    imageViewWarn:        { prefix: "[ImageView]",           method: "warn" },
    sourcePopupWarn:      { prefix: "[SourcePopup]",         method: "warn" },
    actionRegistryWarn:   { prefix: "[ActionRegistry]",      method: "warn" },
    markdownCopyWarn:     { prefix: "[markdownCopy]",        method: "warn" },
    wikiLinkPopupWarn:    { prefix: "[WikiLinkPopup]",       method: "warn" },
    historyWarn:          { prefix: "[History]",             method: "warn" },
    windowCloseLog:       { prefix: "[WindowClose]",         method: "log" },
    windowCloseWarn:      { prefix: "[WindowClose]",         method: "warn" },
    menuDispatcherLog:    { prefix: "[UnifiedMenuDispatcher]", method: "debug" },
    menuDispatcherWarn:   { prefix: "[UnifiedMenuDispatcher]", method: "warn" },
    watcherWarn:          { prefix: "[Watcher]",             method: "warn" },
    exportWarn:           { prefix: "[Export]",              method: "warn" },
    mcpBridgeLog:         { prefix: "[MCP Bridge]",          method: "debug" },
    mdPipelineWarn:       { prefix: "[MarkdownPipeline]",    method: "warn" },
    workspaceWarn:        { prefix: "[Workspace]",           method: "warn" },
    titleBarWarn:         { prefix: "[TitleBar]",            method: "warn" },
    genieWarn:            { prefix: "[Genie]",               method: "warn" },
    imageContextMenuWarn: { prefix: "[ImageContextMenu]",    method: "warn" },
    confirmQuitWarn:      { prefix: "[ConfirmQuit]",         method: "warn" },
    finderFileOpenWarn:   { prefix: "[FinderFileOpen]",      method: "warn" },
    imageHashWarn:        { prefix: "[ImageHashRegistry]",   method: "warn" },
    imageResizeLog:       { prefix: "[ImageResize]",         method: "log" },
    workspaceStorageWarn: { prefix: "[WorkspaceStorage]",    method: "warn" },
    clipboardWarn:        { prefix: "[Clipboard]",           method: "warn" },
    renderWarn:           { prefix: "[Render]",              method: "warn" },
    cleanupWarn:          { prefix: "[Cleanup]",             method: "warn" },
    listClickFixWarn:      { prefix: "[ListClickFix]",        method: "warn" },
    windowContextError:   { prefix: "[WindowContext]",        method: "error" },
    sourceLinkError:      { prefix: "[SourceLink]",           method: "error" },
    resolveMediaError:    { prefix: "[ResolveMedia]",         method: "error" },
    sourcePeekError:      { prefix: "[SourcePeek]",           method: "error" },
    saveError:            { prefix: "[Save]",                 method: "error" },
    tableActionsError:    { prefix: "[TableActions]",         method: "error" },
    imageHashError:       { prefix: "[ImageHashRegistry]",    method: "error" },
    wysiwygAdapterError:  { prefix: "[wysiwygAdapter]",       method: "error" },
  };

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(Object.entries(prefixMap))(
    "%s outputs prefix %s via console.%s",
    (name, { prefix, method }) => {
      const logger = allLoggers[name as keyof typeof allLoggers];
      logger("test message");

      const spy = method === "error" ? console.error : method === "warn" ? console.warn : method === "debug" ? console.debug : console.log;
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(prefix, "test message");
    },
  );
});

/* ------------------------------------------------------------------ */
/*  Dev mode: loggers call console with correct arguments              */
/* ------------------------------------------------------------------ */

describe("debug loggers — dev mode behavior", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes multiple arguments through", () => {
    historyLog("a", 1, true, null);
    expect(console.log).toHaveBeenCalledWith("[History]", "a", 1, true, null);
  });

  it("works with no arguments beyond the prefix", () => {
    autoSaveLog();
    expect(console.log).toHaveBeenCalledWith("[AutoSave]");
  });

  it("passes objects and arrays through", () => {
    const obj = { key: "value", nested: { a: 1 } };
    const arr = [1, 2, 3];
    fileOpsLog(obj, arr);
    expect(console.log).toHaveBeenCalledWith("[FileOps]", obj, arr);
  });

  it("passes undefined and null", () => {
    terminalLog(undefined, null);
    expect(console.log).toHaveBeenCalledWith("[Terminal]", undefined, null);
  });

  it("passes Error objects", () => {
    const err = new Error("boom");
    crashRecoveryLog(err);
    expect(console.log).toHaveBeenCalledWith("[CrashRecovery]", err);
  });

  it("handles Unicode and CJK strings", () => {
    geniesLog("\u4f60\u597d\u4e16\u754c", "\u{1F389}", "\u65e5\u672c\u8a9e\u30c6\u30b9\u30c8");
    expect(console.log).toHaveBeenCalledWith("[Genies]", "\u4f60\u597d\u4e16\u754c", "\u{1F389}", "\u65e5\u672c\u8a9e\u30c6\u30b9\u30c8");
  });

  it("handles many arguments", () => {
    const args = Array.from({ length: 20 }, (_, i) => `arg${i}`);
    updateCheckerLog(...args);
    expect(console.log).toHaveBeenCalledWith("[UpdateChecker]", ...args);
  });

  it("handles numeric edge values", () => {
    aiProviderLog(0, -1, Infinity, -Infinity, NaN);
    expect(console.log).toHaveBeenCalledWith("[AIProvider]", 0, -1, Infinity, -Infinity, NaN);
  });

  it("handles empty string", () => {
    mcpAutoStartLog("");
    expect(console.log).toHaveBeenCalledWith("[MCP]", "");
  });

  it("warn loggers pass arguments correctly", () => {
    hotExitWarn("disk full", { code: 28 });
    expect(console.warn).toHaveBeenCalledWith("[HotExit]", "disk full", { code: 28 });
  });

  it("debug loggers pass arguments correctly", () => {
    menuDispatcherLog("event fired", { id: "toggle" });
    expect(console.debug).toHaveBeenCalledWith("[UnifiedMenuDispatcher]", "event fired", { id: "toggle" });
  });

  it("mcpBridgeLog uses console.debug", () => {
    mcpBridgeLog("bridge event");
    expect(console.debug).toHaveBeenCalledWith("[MCP Bridge]", "bridge event");
  });

  it("error loggers use console.error", () => {
    windowContextError("init failed", { code: 42 });
    expect(console.error).toHaveBeenCalledWith("[WindowContext]", "init failed", { code: 42 });
  });
});

/* ------------------------------------------------------------------ */
/*  No-throw guarantee: loggers never throw for any argument type      */
/* ------------------------------------------------------------------ */

describe("debug loggers — no-throw guarantee", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const edgeCaseArgs: unknown[][] = [
    [],
    [undefined],
    [null],
    [0],
    [""],
    [false],
    [Symbol("test")],
    [BigInt(9007199254740991)],
    [() => "fn"],
    [{ circular: null as unknown }],
    [new Map([["a", 1]])],
    [new Set([1, 2, 3])],
    [new Date()],
    [/regex/gi],
    [new ArrayBuffer(8)],
    [new Uint8Array([1, 2, 3])],
  ];

  it.each(Object.keys(allLoggers))(
    "%s does not throw for any edge-case argument",
    (name) => {
      const logger = allLoggers[name as keyof typeof allLoggers];
      for (const args of edgeCaseArgs) {
        expect(() => logger(...args)).not.toThrow();
      }
    },
  );
});

/* ------------------------------------------------------------------ */
/*  Production mode: loggers are no-ops                                */
/* ------------------------------------------------------------------ */

describe("debug loggers — production mode (DEV=false)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("production debug/log loggers are silent; warn/error loggers output to console as fallback", async () => {
    vi.stubEnv("DEV", false);
    vi.resetModules();

    const prodDebug = await import("../debug");

    // Debug/log loggers should be silent in production
    prodDebug.historyLog("should not appear");
    prodDebug.autoSaveLog("should not appear");
    prodDebug.menuDispatcherLog("should not appear");
    prodDebug.mcpBridgeLog("should not appear");
    expect(console.log).not.toHaveBeenCalled();
    expect(console.debug).not.toHaveBeenCalled();

    // Warn/error loggers should still output to console as fallback
    prodDebug.hotExitWarn("disk full");
    expect(console.warn).toHaveBeenCalledWith("[HotExit]", "disk full");
    prodDebug.windowContextError("init failed");
    expect(console.error).toHaveBeenCalledWith("[WindowContext]", "init failed");

    vi.unstubAllEnvs();
  });

  it("production loggers are callable with any arguments without throwing", async () => {
    vi.stubEnv("DEV", false);
    vi.resetModules();

    const prodDebug = await import("../debug");

    expect(() => prodDebug.historyLog()).not.toThrow();
    expect(() => prodDebug.historyLog("a", 1, null, undefined, {})).not.toThrow();
    expect(() => prodDebug.hotExitWarn(new Error("test"))).not.toThrow();
    expect(() => prodDebug.fileOpsLog(Symbol("s"), BigInt(42))).not.toThrow();
    expect(() => prodDebug.menuDispatcherLog("event")).not.toThrow();
    expect(() => prodDebug.mcpBridgeLog("bridge")).not.toThrow();
    expect(() => prodDebug.imageHandlerWarn("handler")).not.toThrow();
    expect(() => prodDebug.windowContextError("init failed")).not.toThrow();
    expect(() => prodDebug.wysiwygAdapterError("transform failed")).not.toThrow();

    vi.unstubAllEnvs();
  });
});
