// @vitest-environment node
// WI-AL3.2 — the comment action lock is held per document across component lifetimes: a second take of a held document is refused, another document is independent, a release frees it, and subscribers hear each take and release
import { describe, it, expect, vi, afterEach } from "vitest";
import { isCommentActionLocked, releaseCommentAction, subscribeCommentActionLock, takeCommentAction } from "../commentActionLock";

afterEach(() => {
  releaseCommentAction("a");
  releaseCommentAction("b");
});

describe("the comment action lock", () => {
  it("refuses a second take of a held document and frees it on release", () => {
    expect(takeCommentAction("a")).toBe(true);
    expect(isCommentActionLocked("a")).toBe(true);
    expect(takeCommentAction("a")).toBe(false);
    releaseCommentAction("a");
    expect(isCommentActionLocked("a")).toBe(false);
    expect(takeCommentAction("a")).toBe(true);
  });

  it("holds each document independently", () => {
    expect(takeCommentAction("a")).toBe(true);
    expect(isCommentActionLocked("b")).toBe(false);
    expect(takeCommentAction("b")).toBe(true);
  });

  it("tells subscribers of each take and release, and stops after unsubscribing", () => {
    const heard = vi.fn();
    const unsubscribe = subscribeCommentActionLock(heard);
    takeCommentAction("a");
    takeCommentAction("a");
    releaseCommentAction("a");
    expect(heard).toHaveBeenCalledTimes(2);
    unsubscribe();
    takeCommentAction("a");
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
