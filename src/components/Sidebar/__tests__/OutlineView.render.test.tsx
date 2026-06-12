// WI-2.4 — a cursor move (active-heading change) must not reconcile the whole
// outline tree (O5). We count component renders via the per-render
// useTranslation call and assert only the affected item re-renders.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";

let renderCount = 0;
vi.mock("react-i18next", () => ({
  useTranslation: () => {
    renderCount++;
    return { t: (k: string) => k };
  },
}));

vi.mock("@/hooks/useDocumentState", () => ({
  useDocumentContent: () => "# Alpha\n\n## Beta\n\n## Gamma\n\n# Delta\n",
}));

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/utils/perfLog", () => ({
  perfStart: vi.fn(),
  perfEnd: vi.fn(),
}));

vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

import { OutlineView } from "../OutlineView";
import { useUIStore } from "@/stores/uiStore";

describe("OutlineView render isolation (WI-2.4)", () => {
  beforeEach(() => {
    cleanup();
    renderCount = 0;
    useUIStore.setState({ activeHeadingLine: null });
  });

  it("does not re-render the whole tree when the active heading changes", () => {
    render(<OutlineView />);
    // Sanity: multiple heading items rendered (OutlineView + items).
    expect(renderCount).toBeGreaterThan(2);

    const afterInitial = renderCount;
    act(() => {
      useUIStore.getState().setActiveHeadingLine(1);
    });

    // Only the newly-active item self-subscribes and re-renders. Before the
    // fix, OutlineView and every OutlineItem re-rendered (delta == item count).
    const delta = renderCount - afterInitial;
    expect(delta).toBeLessThanOrEqual(2);
  });
});
