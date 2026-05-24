/**
 * commandPaletteStore tests — ADR-012.
 */

import { beforeEach, describe, it, expect } from "vitest";
import { useCommandPaletteStore } from "./commandPaletteStore";

describe("commandPaletteStore", () => {
  beforeEach(() => {
    useCommandPaletteStore.setState({ isOpen: false });
  });

  it("starts closed", () => {
    expect(useCommandPaletteStore.getState().isOpen).toBe(false);
  });

  it("open() opens", () => {
    useCommandPaletteStore.getState().open();
    expect(useCommandPaletteStore.getState().isOpen).toBe(true);
  });

  it("close() closes", () => {
    useCommandPaletteStore.getState().open();
    useCommandPaletteStore.getState().close();
    expect(useCommandPaletteStore.getState().isOpen).toBe(false);
  });

  it("toggle() flips", () => {
    useCommandPaletteStore.getState().toggle();
    expect(useCommandPaletteStore.getState().isOpen).toBe(true);
    useCommandPaletteStore.getState().toggle();
    expect(useCommandPaletteStore.getState().isOpen).toBe(false);
  });
});
