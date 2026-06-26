import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMarkdownSplitDefault } from "./useMarkdownSplitDefault";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUIStore } from "@/stores/uiStore";

beforeEach(() => {
  useUIStore.getState().setMarkdownSplitView(false);
  useSettingsStore.getState().updateMarkdownSetting("splitViewByDefault", false);
});

describe("useMarkdownSplitDefault", () => {
  it("seeds the live split view from the persisted default on mount", () => {
    useSettingsStore.getState().updateMarkdownSetting("splitViewByDefault", true);
    renderHook(() => useMarkdownSplitDefault());
    expect(useUIStore.getState().markdownSplitView).toBe(true);
  });

  it("leaves the live view off when the default is off", () => {
    renderHook(() => useMarkdownSplitDefault());
    expect(useUIStore.getState().markdownSplitView).toBe(false);
  });
});
