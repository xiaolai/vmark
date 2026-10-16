/**
 * #1565 — an image-heavy document must not fetch and decode every image the
 * moment it opens (real engine).
 *
 * A ~0.5 MB document with 338 local images froze the window on open: each
 * block image view assigned its `src` at construction, so the webview fetched
 * and decoded every image (~315 MiB as RGBA) before it was ever scrolled to,
 * starving the main thread long enough that the menu commands missed their
 * mount deadline. jsdom has no layout and fetches nothing; only a real engine
 * shows which images a scrolling editor actually loads.
 *
 * Built from the production node view inside the editor's DOM shape
 * (`.editor-content` scrolling a `.ProseMirror`). The image URLs are external
 * so no Tauri path resolution is needed, and each carries its own query so
 * the engine's memory cache cannot answer for another.
 */
// timer-isolation: intentional real timers — a real engine fetches and decodes on its own clock; fake timers cannot drive it, and the settle window is what lets an eager load show itself
import { describe, it, expect, afterEach } from "vitest";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { BlockImageNodeView } from "../BlockImageNodeView";

const IMAGE_COUNT = 200;

function blockImageNode(src: string): PMNode {
  return { type: { name: "block_image" }, attrs: { src, alt: "", title: "" } } as unknown as PMNode;
}

/** Images the engine has fetched and decoded. */
function loadedImages(views: readonly BlockImageNodeView[]): number {
  return views.filter((view) => view.dom.querySelector("img")!.naturalWidth > 0).length;
}

/** Long enough for an eager engine to fetch and decode every image. */
const SETTLE_MS = 1500;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("block image loading near the viewport (real engine)", () => {
  const views: BlockImageNodeView[] = [];
  let root: HTMLElement | null = null;

  afterEach(() => {
    views.forEach((view) => view.destroy());
    views.length = 0;
    root?.remove();
    root = null;
  });

  it("fetches the images near the viewport, not the whole document, and the rest as the reader scrolls", async () => {
    root = document.createElement("div");
    root.className = "editor-content";
    root.style.cssText = "height: 600px; overflow-y: auto;";
    const pm = document.createElement("div");
    pm.className = "ProseMirror";
    root.appendChild(pm);
    document.body.appendChild(root);

    // Served by the test server; any real image does.
    const base = new URL("/src/assets/app-icon.png", location.href).href;
    const marker = `img-1565-${crypto.randomUUID()}`;
    for (let i = 0; i < IMAGE_COUNT; i++) {
      // A paragraph's worth of height between images, as in a real document.
      const paragraph = document.createElement("p");
      paragraph.style.height = "600px";
      pm.appendChild(paragraph);
      const view = new BlockImageNodeView(
        blockImageNode(`${base}?${marker}=${i}`),
        () => undefined,
        {} as Editor,
        undefined,
        pm,
      );
      views.push(view);
      pm.appendChild(view.dom);
    }

    await expect.poll(() => loadedImages(views), { timeout: 5000 }).toBeGreaterThan(0);
    await wait(SETTLE_MS);
    const atOpen = loadedImages(views);
    expect(atOpen).toBeLessThan(IMAGE_COUNT / 10);

    // Jump to the end: the images there load once the reader arrives.
    root.scrollTop = root.scrollHeight;
    const last = views[IMAGE_COUNT - 1].dom.querySelector("img")!;
    await expect.poll(() => last.naturalWidth, { timeout: 5000 }).toBeGreaterThan(0);
  });
});
