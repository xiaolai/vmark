// Audit 20260907 (#283) — the focus-restoration effect WorkflowEditorPanel
// carried inline: after a step→step navigation remount, keyboard focus is put
// back on a nav button; an initial selection (null → step) never steals it.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStepFocusRestore } from "../useStepFocusRestore";

// Audit R2 (#586): the query is scoped to the panel's own root and selects on
// `data-step-nav`. It used to be a document-wide `querySelector` matching an
// ENGLISH aria-label substring — so with two panes mounted it could focus the
// other pane's button, and in any other locale it matched nothing at all.
let root: HTMLElement;
const rootRef = { current: null as HTMLElement | null };

function navButton(nav: string, disabled = false, into: HTMLElement = root): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "workflow-form__nav-btn";
  btn.dataset["stepNav"] = nav;
  if (disabled) btn.disabled = true;
  into.appendChild(btn);
  return btn;
}

beforeEach(() => {
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.appendChild(root);
  rootRef.current = root;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useStepFocusRestore", () => {
  it("focuses the Next button after a step→step navigation", () => {
    const next = navButton("next");
    navButton("prev");
    const { rerender } = renderHook(({ id }: { id: string | null }) => useStepFocusRestore(id, rootRef), {
      initialProps: { id: "s1" as string | null },
    });
    rerender({ id: "s2" });
    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(next);
  });

  // Audit R2 (#588): Next-first regardless of direction meant that walking
  // BACKWARD put focus on Next, so the user's next Enter went forward again.
  it("keeps the direction: after Previous, focus returns to Previous", () => {
    navButton("next");
    const prev = navButton("prev");
    const { rerender } = renderHook(({ id }: { id: string | null }) => useStepFocusRestore(id, rootRef), {
      initialProps: { id: "s2" as string | null },
    });
    prev.focus(); // the user is walking backward
    rerender({ id: "s1" });
    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(prev);
  });

  it("falls back to the fixed order when the remembered control is disabled", () => {
    const next = navButton("next");
    const prev = navButton("prev");
    const { rerender } = renderHook(({ id }: { id: string | null }) => useStepFocusRestore(id, rootRef), {
      initialProps: { id: "s2" as string | null },
    });
    prev.focus();
    prev.disabled = true; // the first step: there is no Previous any more
    rerender({ id: "s1" });
    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(next);
  });

  it("falls back to Previous, then Back to job, when Next is disabled", () => {
    navButton("next", true);
    const back = navButton("back-to-job");
    const { rerender } = renderHook(({ id }: { id: string | null }) => useStepFocusRestore(id, rootRef), {
      initialProps: { id: "s1" as string | null },
    });
    rerender({ id: "s2" });
    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(back);
  });

  it("does NOT focus anything on the initial selection (null → step)", () => {
    navButton("next");
    const before = document.activeElement;
    const { rerender } = renderHook(({ id }: { id: string | null }) => useStepFocusRestore(id, rootRef), {
      initialProps: { id: null as string | null },
    });
    rerender({ id: "s1" });
    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(before);
  });

  it("does NOT focus anything when the selection is cleared (step → null)", () => {
    navButton("next");
    const before = document.activeElement;
    const { rerender } = renderHook(({ id }: { id: string | null }) => useStepFocusRestore(id, rootRef), {
      initialProps: { id: "s1" as string | null },
    });
    rerender({ id: null });
    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(before);
  });

  it("cancels the pending frame when the selection moves again before it runs", () => {
    const next = navButton("next");
    const { rerender, unmount } = renderHook(({ id }: { id: string | null }) => useStepFocusRestore(id, rootRef), {
      initialProps: { id: "s1" as string | null },
    });
    rerender({ id: "s2" });
    unmount();
    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).not.toBe(next);
  });

  it("never focuses a nav button OUTSIDE its own root", () => {
    // Two mounted panels see the same selection change; a document-wide query
    // put focus on whichever pane came first in the DOM (audit R2, #586).
    const otherPane = document.createElement("div");
    document.body.insertBefore(otherPane, root);
    const foreign = navButton("next", false, otherPane);
    const mine = navButton("next");
    const { rerender } = renderHook(({ id }: { id: string | null }) => useStepFocusRestore(id, rootRef), {
      initialProps: { id: "s1" as string | null },
    });
    rerender({ id: "s2" });
    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(mine);
    expect(document.activeElement).not.toBe(foreign);
  });

  it("does nothing when the panel root is gone", () => {
    navButton("next");
    const detached = { current: null as HTMLElement | null };
    const before = document.activeElement;
    const { rerender } = renderHook(({ id }: { id: string | null }) => useStepFocusRestore(id, detached), {
      initialProps: { id: "s1" as string | null },
    });
    rerender({ id: "s2" });
    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(before);
  });
});
