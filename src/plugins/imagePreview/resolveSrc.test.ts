// @vitest-environment node
/**
 * `resolveSrc`'s document lookup, including the failure path.
 *
 * The lookup goes through `plugins/shared/hostDocument` rather than the app's
 * tab and document stores (ADR-015), and since WI-11 the WINDOW comes through
 * the same seam — no `@/services/navigation/windowFocus` import to mock. The
 * guard around it still matters: the host's window lookup can throw outside a
 * Tauri window, and a preview that throws would take the editor down with it.
 *
 * The assertions are on the exact resolved URL, not `toContain("pic.png")`:
 * the unresolved src contains that too, so the weaker form passed whether or
 * not the document path was ever consulted.
 *
 * @coordinates-with plugins/imagePreview/resolveSrc.ts
 * @module plugins/imagePreview/resolveSrc.test
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => `asset://${p}` }));

import { resolveImageSrc } from "./resolveSrc";
import { bindHostDocument, resetHostDocument } from "@/plugins/shared/hostDocument";

afterEach(resetHostDocument);

describe("resolving against the active document", () => {
  it("uses the host's path for a relative src", async () => {
    bindHostDocument({
      currentWindowLabel: () => "main",
      activeFilePath: () => "/docs/note.md",
    });
    expect(await resolveImageSrc("pic.png")).toBe("asset:///docs/pic.png");
  });

  it("survives a window lookup that THROWS", async () => {
    // The host's window lookup raises outside a Tauri window. Falling back to
    // the unresolved src is what keeps a preview from taking the editor down.
    bindHostDocument({
      currentWindowLabel: () => {
        throw new Error("no window");
      },
      activeFilePath: () => "/docs/note.md",
    });
    expect(await resolveImageSrc("pic.png")).toBe("pic.png");
  });
});
