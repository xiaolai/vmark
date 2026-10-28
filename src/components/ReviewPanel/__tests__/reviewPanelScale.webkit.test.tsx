// WI-AL2.4 — R8 at the review panel's scale, in real WebKit: a document at the restore slot limit (600 live hunks) renders the PRODUCTION review panel with its real stylesheets, paints within 100 ms, and scrolling to the end shows the last row within 100 ms; the windowed list keeps only the rows in view mounted
import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import "@/styles/index.css";
import "@/styles/button-shared.css";
import "@/styles/icon-button-shared.css";
import "@/components/McpHistory/mcp-history.css";
import type { DocumentHistory, LiveHunk } from "@/services/agentJournal/docHistoryClient";
import { ReviewPanel } from "../ReviewPanel";

/** The writer's restore slot limit (`RESTORE_SLOT_LIMIT` in `review_slots.rs`). */
const ROWS = 600;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function history(): DocumentHistory {
  const hunks: LiveHunk[] = Array.from({ length: ROWS }, (_, i) => ({
    hunkId: `h-${i}`,
    kind: "change",
    state: "pending",
    target: "rev-1",
    baseRange: { from: i * 4, to: i * 4 + 2 },
    targetRange: { from: i * 4, to: i * 4 + 3 },
    reviewGen: "1",
    span: { from: i * 4, to: i * 4 + 3 },
    editedSince: false,
  }));
  return {
    generation: "1",
    head: "rev-1",
    rows: [
      {
        revision: "rev-1",
        seq: "1",
        at: 1_000,
        kind: "controlled",
        parent: null,
        actor: { type: "mcp", principal: { state: "provider", provider: "claude" }, connectionId: "c-1", sessionLabel: null, displayName: null },
        initiator: null,
        tool: "document.write",
        restore: false,
        collected: false,
        addresses: [],
      },
    ],
    truncated: false,
    hunks,
    blocked: [],
    degraded: false,
  };
}

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
});

describe("ReviewPanel at scale (real WebKit)", () => {
  it("600 rows paint and scroll to the last row within 100 ms each", async () => {
    host = document.createElement("div");
    host.style.cssText = "width: 380px";
    document.body.append(host);
    root = createRoot(host);
    const data = history();
    await nextFrame();

    const paintStart = performance.now();
    flushSync(() => root!.render(<ReviewPanel tabId="t-1" docKey="path:/a.md" history={data} onChanged={() => {}} />));
    await nextFrame();
    const paint = performance.now() - paintStart;

    const viewport = host.querySelector<HTMLElement>("[data-testid='review-list']")!;
    expect(viewport).not.toBeNull();
    // One group header plus one row per hunk, but only a window of them mounted.
    const items = () => host!.querySelectorAll("[role='listitem']");
    expect(items()[0].getAttribute("aria-setsize")).toBe(String(ROWS + 1));
    expect(items().length).toBeLessThan(20);
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight * 50);

    const scrollStart = performance.now();
    viewport.scrollTop = viewport.scrollHeight;
    let last: Element | null = null;
    while (!last && performance.now() - scrollStart < 1_000) {
      await nextFrame();
      last = host.querySelector(`[data-hunk-id='h-${ROWS - 1}']`);
    }
    const scroll = performance.now() - scrollStart;

    expect(paint).toBeLessThanOrEqual(100);
    expect(scroll).toBeLessThanOrEqual(100);
    expect(last).not.toBeNull();
    expect(last).toBeVisible();
    // The last row is inside the viewport, not merely mounted.
    const row = last!.getBoundingClientRect();
    const view = viewport.getBoundingClientRect();
    expect(row.bottom).toBeLessThanOrEqual(view.bottom + 1);
    expect(row.top).toBeGreaterThanOrEqual(view.top - 1);
  });
});
