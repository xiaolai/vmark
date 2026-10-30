/**
 * ExportSurface — the read-only Tiptap render every export and print shares,
 * and its stability gate: `onReady` fires once, only after pending math,
 * Mermaid and image renders have settled, or after the polling budget runs
 * out; an unmount cancels a pending poll.
 *
 * Real Tiptap render in jsdom. The pending states are the DOM markers the
 * render pipeline sets (`.code-block-preview-placeholder`, `.mermaid-loading`,
 * an `<img>` with no source yet), added to the surface's own container.
 */
import { createRef } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportSurface, type ExportSurfaceRef } from "../ExportSurface";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Advance past one stability poll and the extra layout frame after it. */
async function poll(ms = 150): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function mount(markdown: string, extra: { lightTheme?: boolean; className?: string } = {}) {
  const ref = createRef<ExportSurfaceRef>();
  const onReady = vi.fn();
  const view = render(<ExportSurface ref={ref} markdown={markdown} onReady={onReady} {...extra} />);
  return { ref, onReady, view };
}

function addPending(ref: { current: ExportSurfaceRef | null }, html: string): HTMLElement {
  const marker = document.createElement("div");
  marker.innerHTML = html;
  ref.current!.getContainer()!.appendChild(marker);
  return marker;
}

describe("ExportSurface — the render", () => {
  it("renders the markdown and hands back the editor's HTML and its container", async () => {
    const { ref, onReady } = mount("# Title\n\nBody text");
    await poll();

    expect(onReady).toHaveBeenCalledOnce();
    expect(ref.current!.getHTML()).toMatch(/<h1[^>]*>Title<\/h1>/);
    expect(ref.current!.getHTML()).toContain("Body text");
    expect(ref.current!.getContainer()?.classList.contains("export-surface")).toBe(true);
  });

  it("carries the dark theme and the caller's class on the container", async () => {
    const { ref } = mount("x", { lightTheme: false, className: "for-print" });
    await poll();

    const classes = ref.current!.getContainer()!.classList;
    expect(classes.contains("dark-theme")).toBe(true);
    expect(classes.contains("for-print")).toBe(true);
  });

  it("never reports ready for an empty document — there is nothing to render", async () => {
    const { onReady } = mount("");
    await poll(1000);

    expect(onReady).not.toHaveBeenCalled();
  });
});

describe("ExportSurface — waits for async renders", () => {
  it.each([
    ["a pending math preview", '<span class="code-block-preview-placeholder"></span>'],
    ["a loading Mermaid diagram", '<div class="mermaid-loading"></div>'],
    ["an image with no source yet", '<img alt="pending">'],
  ])("holds onReady while %s is on the page, then fires once", async (_label, html) => {
    const { ref, onReady } = mount("# Doc");
    const marker = addPending(ref, html);

    await poll(500);
    expect(onReady).not.toHaveBeenCalled();

    marker.remove();
    await poll();
    expect(onReady).toHaveBeenCalledOnce();

    await poll(1000);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it("proceeds after the polling budget when a render never settles", async () => {
    const { ref, onReady } = mount("# Doc");
    addPending(ref, '<div class="mermaid-loading"></div>');

    await poll(4000);
    expect(onReady).not.toHaveBeenCalled();

    await poll(2000);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it("stops polling when it unmounts first", async () => {
    const { ref, onReady, view } = mount("# Doc");
    addPending(ref, '<div class="mermaid-loading"></div>');
    await poll(300);

    view.unmount();
    await poll(10_000);

    expect(onReady).not.toHaveBeenCalled();
  });
});
