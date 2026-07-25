import { describe, it, expect, beforeEach } from "vitest";
import { useQuickOpenStore } from "./quickOpenStore";

beforeEach(() => {
  useQuickOpenStore.setState({ isOpen: false });
});

describe("quickOpenStore", () => {
  it("starts closed", () => {
    expect(useQuickOpenStore.getState().isOpen).toBe(false);
  });

  it("opens", () => {
    useQuickOpenStore.getState().open();
    expect(useQuickOpenStore.getState().isOpen).toBe(true);
  });

  it("closes", () => {
    useQuickOpenStore.getState().open();
    useQuickOpenStore.getState().close();
    expect(useQuickOpenStore.getState().isOpen).toBe(false);
  });

  it("toggles open then closed", () => {
    useQuickOpenStore.getState().toggle();
    expect(useQuickOpenStore.getState().isOpen).toBe(true);
    useQuickOpenStore.getState().toggle();
    expect(useQuickOpenStore.getState().isOpen).toBe(false);
  });
});
