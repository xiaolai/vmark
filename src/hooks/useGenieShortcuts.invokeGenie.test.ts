/**
 * Tests for the menu:invoke-genie effect in useGenieShortcuts.
 *
 * The native Genies menu lists BOTH markdown prompts (.md) and YAML
 * workflows (.yml/.yaml); `read_genie` returns raw YAML as `template` for
 * the latter. The handler must derive the `kind` discriminator from the
 * file extension (the same source the Rust scanner classifies by), or a
 * workflow genie invoked from the menu takes the PROMPT path in
 * useGenieInvocation — sending raw workflow YAML to the AI as a prompt.
 *
 * Pure-helper coverage (getMenuShortcuts, detectScope) lives in
 * useGenieShortcuts.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenieDefinition } from "@/types/aiGenies";

// ── Mocks (must be hoisted above the SUT import) ──────────────────────

type EventHandler = (event: { payload: unknown }) => void | Promise<void>;
const listenHandlers = new Map<string, EventHandler>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, handler: EventHandler) => {
    listenHandlers.set(event, handler);
    return Promise.resolve(() => {});
  }),
}));

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockInvokeGenie = vi.fn(() => Promise.resolve());
vi.mock("@/hooks/useGenieInvocation", () => ({
  useGenieInvocation: () => ({ invokeGenie: mockInvokeGenie }),
}));

vi.mock("@/stores/settingsStore", () => ({
  useShortcutsStore: {
    getState: () => ({
      getAllShortcuts: () => ({}),
      getShortcut: () => null,
    }),
  },
  prosemirrorToTauri: (key: string) => key,
}));

vi.mock("@/stores/geniePickerStore", () => ({
  useGeniePickerStore: {
    getState: () => ({ isOpen: false, openPicker: vi.fn(), closePicker: vi.fn() }),
  },
}));

vi.mock("@/stores/aiStore", () => ({
  useGeniesStore: {
    getState: () => ({ loadGenies: vi.fn(() => Promise.resolve()) }),
  },
  initSuggestionTabWatcher: vi.fn(),
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: { subscribe: vi.fn(() => () => {}) },
}));

vi.mock("@/stores/uiStore", () => ({
  useUIStore: { getState: () => ({ sourceMode: false }) },
}));

vi.mock("@/stores/editorStore", () => ({
  useEditorStore: { getState: () => ({ tiptap: { editor: null } }) },
}));

import { act, renderHook } from "@testing-library/react";
import { useGenieShortcuts } from "./useGenieShortcuts";

const WORKFLOW_METADATA = {
  name: "review",
  description: "Review workflow",
  scope: "document" as const,
};
const MARKDOWN_METADATA = {
  name: "improve",
  description: "Improve prose",
  scope: "selection" as const,
};

/** Mount the hook and fire menu:invoke-genie with the given payload. */
async function invokeFromMenu(path: string, title: string): Promise<void> {
  renderHook(() => useGenieShortcuts());
  const handler = listenHandlers.get("menu:invoke-genie");
  expect(handler).toBeDefined();
  await act(async () => {
    await handler!({ payload: [path, title] });
  });
}

beforeEach(() => {
  listenHandlers.clear();
  mockInvoke.mockReset();
  mockInvokeGenie.mockClear();
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "read_genie") {
      return Promise.resolve({ metadata: WORKFLOW_METADATA, template: "steps:\n  - id: s1" });
    }
    return Promise.resolve();
  });
});

describe("menu:invoke-genie kind derivation", () => {
  it("routes a .yml genie to the workflow path (kind: 'workflow')", async () => {
    await invokeFromMenu("/genies/review.yml", "review");

    expect(mockInvokeGenie).toHaveBeenCalledTimes(1);
    const genie = mockInvokeGenie.mock.calls[0]![0] as unknown as GenieDefinition;
    expect(genie.kind).toBe("workflow");
    expect(genie.filePath).toBe("/genies/review.yml");
    expect(genie.template).toBe("steps:\n  - id: s1");
  });

  it("routes a .yaml genie to the workflow path (case-insensitive extension)", async () => {
    await invokeFromMenu("/genies/review.YAML", "review");

    const genie = mockInvokeGenie.mock.calls[0]![0] as unknown as GenieDefinition;
    expect(genie.kind).toBe("workflow");
  });

  it("routes a .md genie to the prompt path (kind: 'markdown')", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "read_genie") {
        return Promise.resolve({ metadata: MARKDOWN_METADATA, template: "Improve: {{text}}" });
      }
      return Promise.resolve();
    });

    await invokeFromMenu("/genies/improve.md", "improve");

    expect(mockInvokeGenie).toHaveBeenCalledTimes(1);
    const genie = mockInvokeGenie.mock.calls[0]![0] as unknown as GenieDefinition;
    expect(genie.kind).toBe("markdown");
    expect(genie.template).toBe("Improve: {{text}}");
  });

  it("does not invoke when read_genie fails", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "read_genie") return Promise.reject(new Error("not found"));
      return Promise.resolve();
    });

    await invokeFromMenu("/genies/gone.md", "gone");

    expect(mockInvokeGenie).not.toHaveBeenCalled();
  });
});
