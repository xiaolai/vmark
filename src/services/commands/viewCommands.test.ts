// WI-5.1 — Knowledge Base panel reachable via command/menu (plan-audit C-1).
import { beforeEach, describe, expect, it } from "vitest";
import {
  registerViewCommands,
  __resetViewCommandsRegistration,
} from "./viewCommands";
import { getCommand, executeCommand, _resetCommandBus } from "./CommandBus";
import { useContentServerStore } from "@/stores/contentServerStore";

beforeEach(() => {
  _resetCommandBus();
  __resetViewCommandsRegistration();
  useContentServerStore.getState().reset();
});

describe("view.toggleKnowledgeBase", () => {
  it("is registered as a view command", () => {
    registerViewCommands();
    expect(getCommand("view.toggleKnowledgeBase")).toBeDefined();
    expect(getCommand("view.toggleKnowledgeBase")?.category).toBe("view");
  });

  it("toggles the KB panel open then closed", async () => {
    registerViewCommands();
    expect(useContentServerStore.getState().panelOpen).toBe(false);
    expect(await executeCommand("view.toggleKnowledgeBase")).toBe(true);
    expect(useContentServerStore.getState().panelOpen).toBe(true);
    await executeCommand("view.toggleKnowledgeBase");
    expect(useContentServerStore.getState().panelOpen).toBe(false);
  });
});
