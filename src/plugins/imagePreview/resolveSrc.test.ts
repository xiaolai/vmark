/**
 * `resolveSrc`'s document lookup, including the failure path.
 *
 * The lookup goes through `plugins/shared/hostDocument` rather than the app's
 * tab and document stores (ADR-015). The guard around it still matters:
 * `getWindowLabel()` can throw outside a Tauri window, and a preview that
 * throws would take the editor down with it.
 *
 * @coordinates-with plugins/imagePreview/resolveSrc.ts
 * @module plugins/imagePreview/resolveSrc.test
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const getWindowLabel = vi.fn(() => "main");
vi.mock("@/services/navigation/windowFocus", () => ({
  getWindowLabel: () => getWindowLabel(),
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => `asset://${p}` }));

import { resolveImageSrc } from "./resolveSrc";
import { bindHostDocument, resetHostDocument } from "@/plugins/shared/hostDocument";

afterEach(() => {
  resetHostDocument();
  getWindowLabel.mockReturnValue("main");
});

describe("resolving against the active document", () => {
  it("uses the host's path for a relative src", async () => {
    bindHostDocument({ activeFilePath: () => "/docs/note.md" });
    const out = await resolveImageSrc("pic.png");
    expect(out).toContain("pic.png");
  });

  it("survives a window lookup that THROWS", async () => {
    // Outside a Tauri window `getWindowLabel` raises. Returning null here is
    // what keeps a preview from taking the editor down.
    getWindowLabel.mockImplementation(() => {
      throw new Error("no window");
    });
    bindHostDocument({ activeFilePath: () => "/docs/note.md" });
    await expect(resolveImageSrc("pic.png")).resolves.toBeDefined();
  });
});
