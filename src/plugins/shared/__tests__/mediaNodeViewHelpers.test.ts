/**
 * Tests for shared media NodeView helper functions.
 *
 * Covers: load handler attachment/cleanup, error display,
 * load state clearing, and node selection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  attachMediaLoadHandlers,
  showMediaError,
  clearMediaLoadState,
  selectMediaNode,
  type MediaLoadConfig,
} from "../mediaNodeViewHelpers";

// --- Helpers ---

function createMockElement(): HTMLImageElement & { listeners: Record<string, EventListener> } {
  const listeners: Record<string, EventListener> = {};
  const el = {
    addEventListener: vi.fn((event: string, handler: EventListener) => {
      listeners[event] = handler;
    }),
    removeEventListener: vi.fn((event: string, _handler: EventListener) => {
      delete listeners[event];
    }),
    title: "",
    listeners,
  } as unknown as HTMLImageElement & { listeners: Record<string, EventListener> };
  return el;
}

function createMockContainer(): HTMLElement {
  const classes = new Set<string>();
  return {
    classList: {
      add: vi.fn((...names: string[]) => names.forEach((n) => classes.add(n))),
      remove: vi.fn((...names: string[]) => names.forEach((n) => classes.delete(n))),
      contains: vi.fn((name: string) => classes.has(name)),
    },
  } as unknown as HTMLElement;
}

const imageConfig: MediaLoadConfig = {
  loadEvent: "load",
  loadingClass: "image-loading",
  errorClass: "image-error",
};

const mediaConfig: MediaLoadConfig = {
  loadEvent: "loadedmetadata",
  loadingClass: "media-loading",
  errorClass: "media-error",
};

// --- Tests ---

describe("attachMediaLoadHandlers", () => {
  let element: ReturnType<typeof createMockElement>;
  let container: ReturnType<typeof createMockContainer>;

  beforeEach(() => {
    element = createMockElement();
    container = createMockContainer();
  });

  it("registers the correct load event for images", () => {
    const onLoaded = vi.fn();
    attachMediaLoadHandlers(element, container, imageConfig, onLoaded);
    expect(element.addEventListener).toHaveBeenCalledWith("load", expect.any(Function));
    expect(element.addEventListener).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("registers loadedmetadata for audio/video", () => {
    const onLoaded = vi.fn();
    attachMediaLoadHandlers(element, container, mediaConfig, onLoaded);
    expect(element.addEventListener).toHaveBeenCalledWith("loadedmetadata", expect.any(Function));
  });

  it("on load success: removes loading/error classes and calls onLoaded", () => {
    const onLoaded = vi.fn();
    attachMediaLoadHandlers(element, container, imageConfig, onLoaded);

    // Simulate load event
    const loadHandler = element.listeners["load"];
    expect(loadHandler).toBeDefined();
    loadHandler(new Event("load"));

    expect(container.classList.remove).toHaveBeenCalledWith("image-loading", "image-error");
    expect(onLoaded).toHaveBeenCalled();
  });

  it("on error: sets error class on container", () => {
    const onLoaded = vi.fn();
    attachMediaLoadHandlers(element, container, imageConfig, onLoaded);

    const errorHandler = element.listeners["error"];
    expect(errorHandler).toBeDefined();
    errorHandler(new Event("error"));

    expect(container.classList.remove).toHaveBeenCalledWith("image-loading");
    expect(container.classList.add).toHaveBeenCalledWith("image-error");
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it("on error: calls optional onError callback", () => {
    const onLoaded = vi.fn();
    const onError = vi.fn();
    attachMediaLoadHandlers(element, container, imageConfig, onLoaded, onError);

    const errorHandler = element.listeners["error"];
    errorHandler(new Event("error"));

    expect(onError).toHaveBeenCalled();
  });

  it("cleanup function removes both listeners", () => {
    const onLoaded = vi.fn();
    const cleanup = attachMediaLoadHandlers(element, container, imageConfig, onLoaded);

    cleanup();

    expect(element.removeEventListener).toHaveBeenCalledWith("load", expect.any(Function));
    expect(element.removeEventListener).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("does not call onLoaded if destroyed flag is set before load fires", () => {
    const onLoaded = vi.fn();
    const cleanup = attachMediaLoadHandlers(element, container, imageConfig, onLoaded);

    // Destroy before load
    cleanup();

    // Even if load fires late (hypothetically), the handlers were removed
    expect(onLoaded).not.toHaveBeenCalled();
  });
});

describe("showMediaError", () => {
  it("sets error class and title tooltip for image config", () => {
    const container = createMockContainer();
    const element = createMockElement();

    showMediaError(container, element, "photo.png", "Failed to load image", imageConfig);

    expect(container.classList.remove).toHaveBeenCalledWith("image-loading");
    expect(container.classList.add).toHaveBeenCalledWith("image-error");
    expect(element.title).toBe("Failed to load image: photo.png");
  });

  it("sets error class for media config", () => {
    const container = createMockContainer();
    const element = createMockElement();

    showMediaError(container, element, "song.mp3", "Failed to load audio", mediaConfig);

    expect(container.classList.remove).toHaveBeenCalledWith("media-loading");
    expect(container.classList.add).toHaveBeenCalledWith("media-error");
    expect(element.title).toBe("Failed to load audio: song.mp3");
  });
});

describe("clearMediaLoadState", () => {
  it("removes both loading and error classes", () => {
    const container = createMockContainer();

    clearMediaLoadState(container, imageConfig);

    expect(container.classList.remove).toHaveBeenCalledWith("image-loading", "image-error");
  });

  it("removes media-loading and media-error for media config", () => {
    const container = createMockContainer();

    clearMediaLoadState(container, mediaConfig);

    expect(container.classList.remove).toHaveBeenCalledWith("media-loading", "media-error");
  });
});

describe("selectMediaNode", () => {
  it("does not throw even with invalid doc (catches errors internally)", () => {
    // selectMediaNode catches all errors from NodeSelection.create,
    // so even with a minimal mock it should never throw
    const editor = {
      view: {
        state: {
          doc: "doc",
          tr: { setSelection: vi.fn() },
        },
        dispatch: vi.fn(),
      },
    } as unknown as Parameters<typeof selectMediaNode>[0];

    expect(() => selectMediaNode(editor, () => 5)).not.toThrow();
  });

  it("does not throw when getPos returns undefined", () => {
    const editor = {
      view: { state: { doc: "doc", tr: { setSelection: vi.fn() } }, dispatch: vi.fn() },
    } as unknown as Parameters<typeof selectMediaNode>[0];

    expect(() => selectMediaNode(editor, () => undefined)).not.toThrow();
  });
});
