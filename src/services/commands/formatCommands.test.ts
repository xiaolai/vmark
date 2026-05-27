/**
 * Tests for the "Set File Type" override commands.
 *
 * These are the user-facing escape hatch: force a file family to plain
 * text, to markdown, or reset to the default. Each persists a per-key
 * association in settings; the format-settings bridge then recomputes
 * open tabs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastInfo = vi.fn();
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { info: (...a: unknown[]) => toastInfo(...a) },
}));

import {
  executeCommand,
  getCommand,
  _resetCommandBus,
} from "./CommandBus";
import {
  registerFormatCommands,
  __resetFormatCommandsRegistration,
} from "./formatCommands";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";

function setActiveFile(filePath: string | null): string {
  const tabId = useTabStore.getState().createTab("main", filePath);
  useDocumentStore.getState().initDocument(tabId, "", filePath);
  return tabId;
}

function associations() {
  return useSettingsStore.getState().formats.associations;
}

beforeEach(() => {
  _resetCommandBus();
  __resetFormatCommandsRegistration();
  toastInfo.mockClear();
  useTabStore.setState({
    tabs: {},
    activeTabId: {},
    untitledCounter: 0,
    closedTabs: {},
  });
  useDocumentStore.setState({ documents: {} });
  useSettingsStore.setState((s) => ({
    formats: { ...s.formats, associations: {} },
  }));
  registerFormatCommands();
});

afterEach(() => {
  _resetCommandBus();
});

describe("registerFormatCommands", () => {
  it("registers the three override commands", () => {
    expect(getCommand("format.setPlainText")).toBeDefined();
    expect(getCommand("format.setMarkdown")).toBeDefined();
    expect(getCommand("format.resetType")).toBeDefined();
  });

  it("is idempotent (safe to call twice)", () => {
    expect(() => registerFormatCommands()).not.toThrow();
  });
});

describe("format.setPlainText", () => {
  it("associates the file's key with txt", async () => {
    setActiveFile("/proj/notes.txt");
    await executeCommand("format.setPlainText", {}, { windowLabel: "main" });
    expect(associations()).toEqual({ txt: "txt" });
  });

  it("uses the dotfile stem for env-family files", async () => {
    setActiveFile("/proj/.env.local");
    await executeCommand("format.setPlainText", {}, { windowLabel: "main" });
    expect(associations()).toEqual({ ".env": "txt" });
  });

  it("notifies the user", async () => {
    setActiveFile("/proj/.env.local");
    await executeCommand("format.setPlainText", {}, { windowLabel: "main" });
    expect(toastInfo).toHaveBeenCalledTimes(1);
  });
});

describe("format.setMarkdown", () => {
  it("associates the file's key with markdown", async () => {
    setActiveFile("/proj/notes.txt");
    await executeCommand("format.setMarkdown", {}, { windowLabel: "main" });
    expect(associations()).toEqual({ txt: "markdown" });
  });

  it("preserves other associations when adding one", async () => {
    useSettingsStore.setState((s) => ({
      formats: { ...s.formats, associations: { ".env": "txt" } },
    }));
    setActiveFile("/proj/draft.txt");
    await executeCommand("format.setMarkdown", {}, { windowLabel: "main" });
    expect(associations()).toEqual({ ".env": "txt", txt: "markdown" });
  });

  it("is a no-op (no toast, no churn) when the association already equals the target (audit Round A H2)", async () => {
    // Pre-seed: notes.txt already associated as markdown.
    useSettingsStore.setState((s) => ({
      formats: { ...s.formats, associations: { txt: "markdown" } },
    }));
    setActiveFile("/proj/notes.txt");
    const beforeRef = useSettingsStore.getState().formats.associations;
    toastInfo.mockClear();

    await executeCommand("format.setMarkdown", {}, { windowLabel: "main" });

    // No fresh write: the reference is the same (the bridge's reference
    // comparison would otherwise trigger recomputeAllFormatIds globally).
    expect(useSettingsStore.getState().formats.associations).toBe(beforeRef);
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("setPlainText is a no-op when the association already equals txt (audit Round A H2)", async () => {
    useSettingsStore.setState((s) => ({
      formats: { ...s.formats, associations: { txt: "txt" } },
    }));
    setActiveFile("/proj/notes.txt");
    const beforeRef = useSettingsStore.getState().formats.associations;
    toastInfo.mockClear();

    await executeCommand("format.setPlainText", {}, { windowLabel: "main" });

    expect(useSettingsStore.getState().formats.associations).toBe(beforeRef);
    expect(toastInfo).not.toHaveBeenCalled();
  });
});

describe("format.resetType", () => {
  it("removes the association for the active file's key", async () => {
    useSettingsStore.setState((s) => ({
      formats: { ...s.formats, associations: { txt: "markdown", ".env": "txt" } },
    }));
    setActiveFile("/proj/notes.txt");
    await executeCommand("format.resetType", {}, { windowLabel: "main" });
    expect(associations()).toEqual({ ".env": "txt" });
  });

  it("is a no-op when no association exists for the key", async () => {
    setActiveFile("/proj/notes.txt");
    await executeCommand("format.resetType", {}, { windowLabel: "main" });
    expect(associations()).toEqual({});
  });
});

describe("availability (when guard)", () => {
  it("commands are unavailable when there is no active file", () => {
    // No active tab at all.
    const cmd = getCommand("format.setPlainText");
    expect(cmd?.when?.({ windowLabel: "main" })).toBe(false);
  });

  it("commands are unavailable for untitled (no path) documents", () => {
    setActiveFile(null);
    const cmd = getCommand("format.setMarkdown");
    expect(cmd?.when?.({ windowLabel: "main" })).toBe(false);
  });

  it("commands are available when the active document has a path", () => {
    setActiveFile("/proj/notes.txt");
    const cmd = getCommand("format.setPlainText");
    expect(cmd?.when?.({ windowLabel: "main" })).toBe(true);
  });

  it("running a command with no active file is a safe no-op", async () => {
    await executeCommand("format.setPlainText", {}, { windowLabel: "main" });
    expect(associations()).toEqual({});
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("run() is defensively guarded even when invoked directly (bypassing the when gate)", async () => {
    // No active file. Calling run() directly skips executeCommand's `when`
    // check, exercising the in-body `if (!key) return` guard on all three.
    for (const id of ["format.setPlainText", "format.setMarkdown", "format.resetType"]) {
      await getCommand(id)!.run({}, { windowLabel: "main" });
    }
    expect(associations()).toEqual({});
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("defaults the window label to 'main' when the context omits it", async () => {
    setActiveFile("/proj/notes.txt");
    await executeCommand("format.setPlainText", {}, {});
    expect(associations()).toEqual({ txt: "txt" });
  });

  it("is unavailable and a no-op when the active path yields no association key", async () => {
    // A directory-like path reduces to no filename, so associationKey is null.
    setActiveFile("/proj/");
    const cmd = getCommand("format.setPlainText");
    expect(cmd?.when?.({ windowLabel: "main" })).toBe(false);
    await getCommand("format.setMarkdown")!.run({}, { windowLabel: "main" });
    expect(associations()).toEqual({});
  });

  it("is a no-op when the active tab has no backing document", async () => {
    // Tab exists and is active, but its document was never initialized —
    // getDocument(tabId) is undefined, so activeFilePath resolves to null.
    useTabStore.getState().createTab("main", "/proj/orphan.txt");
    // Intentionally NOT calling initDocument.
    const cmd = getCommand("format.setPlainText");
    expect(cmd?.when?.({ windowLabel: "main" })).toBe(false);
    await getCommand("format.setMarkdown")!.run({}, { windowLabel: "main" });
    expect(associations()).toEqual({});
  });

  it("tolerates an undefined associations map (defaults to empty)", async () => {
    // Defensive: a corrupted / pre-migration persisted state could leave
    // associations undefined; the command must still write a clean map.
    useSettingsStore.setState((s) => ({
      formats: {
        ...s.formats,
        associations: undefined as unknown as Record<string, string>,
      },
    }));
    setActiveFile("/proj/notes.txt");
    await executeCommand("format.setPlainText", {}, { windowLabel: "main" });
    expect(associations()).toEqual({ txt: "txt" });
  });
});
