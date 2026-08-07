// @vitest-environment node
/**
 * The host-popups seam — the one for ACTIONS rather than values.
 *
 * Its defaults are no-ops, and that is the interesting property: a plugin
 * lifted out of this repo must still RENDER its content, and simply have no
 * popup to offer. Content is the plugin's job; chrome is the host's.
 *
 * @coordinates-with plugins/shared/hostPopups.ts
 * @module plugins/shared/hostPopups.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostPopups, bindHostPopups, resetHostPopups } from "./hostPopups";

const request = {
  mediaSrc: "a.png",
  mediaNodePos: 3,
  mediaNodeType: "block_image",
  anchorRect: { top: 0, left: 0, right: 10, bottom: 10 },
};

afterEach(resetHostPopups);

describe("an unbound host silently offers no chrome", () => {
  it("does not throw when asked for the media popup", () => {
    // The whole point: no store to reach, so nothing to crash on.
    expect(() => hostPopups.openMediaPopup(request)).not.toThrow();
  });

  it("does not throw when asked for the image menu", () => {
    expect(() =>
      hostPopups.openImageMenu({ position: { x: 1, y: 2 }, imageSrc: "a.png", imageNodePos: 3 })
    ).not.toThrow();
  });
});

describe("binding routes the request to the host", () => {
  it("passes the media request through untouched", () => {
    const open = vi.fn();
    bindHostPopups({ openMediaPopup: open });
    hostPopups.openMediaPopup(request);
    expect(open).toHaveBeenCalledWith(request);
  });

  it("passes the image-menu request through untouched", () => {
    const open = vi.fn();
    const menu = { position: { x: 1, y: 2 }, imageSrc: "a.png", imageNodePos: 3 };
    bindHostPopups({ openImageMenu: open });
    hostPopups.openImageMenu(menu);
    expect(open).toHaveBeenCalledWith(menu);
  });

  it("leaves unbound entries at their no-op default", () => {
    // Partial binding, so adding an entry cannot break an existing host.
    bindHostPopups({ openMediaPopup: vi.fn() });
    expect(() =>
      hostPopups.openImageMenu({ position: { x: 0, y: 0 }, imageSrc: "", imageNodePos: 0 })
    ).not.toThrow();
  });

  it("reads LIVE, so a captured reference cannot go stale", () => {
    const first = vi.fn();
    const second = vi.fn();
    const captured = hostPopups;
    bindHostPopups({ openMediaPopup: first });
    bindHostPopups({ openMediaPopup: second });
    captured.openMediaPopup(request);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});

describe("the unbound defaults are no-ops, and every member routes when bound", () => {
  beforeEach(resetHostPopups);

  it("offers no chrome rather than throwing", () => {
    const rect = { top: 0, left: 0, bottom: 0, right: 0 };
    expect(() => hostPopups.openLinkPopup({ href: "", linkFrom: 0, linkTo: 0, anchorRect: rect })).not.toThrow();
    expect(() =>
      hostPopups.openLinkCreatePopup({ text: "", rangeFrom: 0, rangeTo: 0, anchorRect: rect, showTextInput: false })
    ).not.toThrow();
    expect(() => hostPopups.openWikiLinkPopup({ anchorRect: rect, target: "", nodePos: 0 })).not.toThrow();
    expect(() => hostPopups.openHeadingPicker({ headings: [], onSelect: () => {} })).not.toThrow();
    expect(() => hostPopups.openEditorContextMenu({ position: { x: 0, y: 0 }, snapshot: {} })).not.toThrow();
  });

  it("reports no link surface open and no toolbar to dismiss", () => {
    // Both must be FALSE, not true: a standalone editor has no chrome, so an
    // Escape or a link shortcut must fall through rather than be swallowed.
    expect(hostPopups.anyLinkSurfaceOpen()).toBe(false);
    expect(hostPopups.dismissUniversalToolbar()).toBe(false);
  });

  it("forwards each call to the binding", () => {
    const calls = {
      openLinkPopup: vi.fn(),
      openLinkCreatePopup: vi.fn(),
      openWikiLinkPopup: vi.fn(),
      openHeadingPicker: vi.fn(),
      openEditorContextMenu: vi.fn(),
      anyLinkSurfaceOpen: vi.fn(() => true),
      dismissUniversalToolbar: vi.fn(() => true),
    };
    bindHostPopups(calls);
    const rect = { top: 1, left: 2, bottom: 3, right: 4 };
    hostPopups.openLinkPopup({ href: "a", linkFrom: 1, linkTo: 2, anchorRect: rect });
    hostPopups.openLinkCreatePopup({ text: "t", rangeFrom: 1, rangeTo: 2, anchorRect: rect, showTextInput: true });
    hostPopups.openWikiLinkPopup({ anchorRect: rect, target: "t", nodePos: 3 });
    hostPopups.openHeadingPicker({ headings: [], onSelect: () => {} });
    hostPopups.openEditorContextMenu({ position: { x: 5, y: 6 }, snapshot: null });
    expect(calls.openLinkPopup).toHaveBeenCalledWith(expect.objectContaining({ href: "a" }));
    expect(calls.openLinkCreatePopup).toHaveBeenCalledWith(expect.objectContaining({ text: "t" }));
    expect(calls.openWikiLinkPopup).toHaveBeenCalledWith(expect.objectContaining({ nodePos: 3 }));
    expect(calls.openHeadingPicker).toHaveBeenCalled();
    expect(calls.openEditorContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ position: { x: 5, y: 6 } })
    );
    expect(hostPopups.anyLinkSurfaceOpen()).toBe(true);
    expect(hostPopups.dismissUniversalToolbar()).toBe(true);
  });
});
