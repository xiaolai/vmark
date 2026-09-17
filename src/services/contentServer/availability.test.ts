// @vitest-environment node
// Knowledge Base availability (#1425) — the one predicate every entry point
// shares, so the palette, the shortcut and the native menu item cannot disagree
// about whether the feature is reachable.
import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { knowledgeBaseAvailableHere } from "./availability";

const setDeveloperMode = (developerMode: boolean) =>
  useSettingsStore.setState((s) => ({ advanced: { ...s.advanced, developerMode } }));

beforeEach(() => {
  setDeveloperMode(false);
});

describe("knowledgeBaseAvailableHere (#1425)", () => {
  it("is false by default: no packaged build carries the content server runtime", () => {
    expect(knowledgeBaseAvailableHere()).toBe(false);
  });

  it("is true once Developer Mode is on", () => {
    setDeveloperMode(true);
    expect(knowledgeBaseAvailableHere()).toBe(true);
  });

  it("reads the store on every call, so a toggle takes effect without a reload", () => {
    expect(knowledgeBaseAvailableHere()).toBe(false);
    setDeveloperMode(true);
    expect(knowledgeBaseAvailableHere()).toBe(true);
    setDeveloperMode(false);
    expect(knowledgeBaseAvailableHere()).toBe(false);
  });
});
