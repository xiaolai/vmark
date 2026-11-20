/**
 * The bottom lane must hold its bars, measured in a real engine.
 *
 * The lane under the editor muxes StatusBar, the formatting toolbar and the
 * FindBar. It was a FIXED 40px row, and the FindBar — absolute, bottom-anchored
 * — grows past 40px when its replace row opens or its controls wrap at narrow
 * widths, so it rose out of the lane over the bottom of the document. (Found in
 * the #1465 review; the editor's one-bar bottom padding hid it for one extra
 * row, not for two.)
 *
 * Renders the production EditorArea with the real FindBar/StatusBar styles and
 * a two-row find bar, and measures.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import "@/styles/index.css";
import "@/components/FindBar/FindBar.css";
import "@/components/StatusBar/StatusBar.css";
import "@/components/Editor/UniversalToolbar/universal-toolbar.css";
import { EditorArea } from "./EditorArea";

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(findRows: number) {
  host = document.createElement("div");
  host.style.cssText = `width: ${Math.min(700, window.innerWidth - 16)}px; height: 500px; display: flex`;
  document.body.append(host);
  root = createRoot(host);
  const findBar =
    findRows === 0 ? null : (
      <div className="find-bar" data-testid="find-bar">
        {Array.from({ length: findRows }, (_, i) => (
          <div className="find-bar-row" key={i}>
            <div className="find-bar-input-group">row {i + 1}</div>
          </div>
        ))}
      </div>
    );
  flushSync(() =>
    root!.render(
      <EditorArea
        panelPosition="bottom"
        editor={<div className="probe-editor" style={{ height: "100%" }} />}
        bottomBar={
          <>
            <div className="status-bar-container">
              <div className="status-bar" style={{ height: 40 }}>status</div>
            </div>
            {findBar}
          </>
        }
      />,
    ),
  );
}

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
});

const box = (sel: string) => (document.querySelector(sel) as HTMLElement).getBoundingClientRect();

describe("bottom lane (real engine, production EditorArea)", () => {
  it.each([1, 2, 3])("a %i-row find bar never covers the editor", (rows) => {
    mount(rows);
    const main = box('[role="main"]');
    const find = box('[data-testid="find-bar"]');
    expect(main.bottom).toBeLessThanOrEqual(find.top + 0.5);
  });

  it("a one-row find bar sits at the bottom of the lane, as the absolute bar did", () => {
    mount(1);
    const find = box('[data-testid="find-bar"]');
    const status = box(".status-bar-container");
    expect(Math.round(find.bottom)).toBe(Math.round(status.bottom));
  });

  it("the lane is exactly one bar high when the find bar is closed", () => {
    mount(0);
    const main = box('[role="main"]');
    const status = box(".status-bar-container");
    expect(Math.round(status.bottom - main.bottom)).toBe(40);
  });

  it("the formatting toolbar sits above the status bar and does not cover the tabs", () => {
    host = document.createElement("div");
    host.style.cssText = `width: ${Math.min(700, window.innerWidth - 16)}px; height: 500px; display: flex`;
    document.body.append(host);
    root = createRoot(host);
    flushSync(() =>
      root!.render(
        <EditorArea
          panelPosition="bottom"
          editor={<div className="probe-editor" style={{ height: "100%" }} />}
          bottomBar={
            <>
              <div className="status-bar-container">
                <div className="status-bar" style={{ height: 40 }}>status</div>
              </div>
              <div className="universal-toolbar universal-toolbar--above-status" data-testid="toolbar">
                toolbar
              </div>
            </>
          }
        />,
      ),
    );
    const main = box('[role="main"]');
    const toolbar = box('[data-testid="toolbar"]');
    const status = box(".status-bar-container");
    expect(main.bottom).toBeLessThanOrEqual(toolbar.top + 0.5);
    expect(toolbar.bottom).toBeLessThanOrEqual(status.top + 0.5);
    expect(Math.round(status.height)).toBe(40);
    expect(Math.round(toolbar.height)).toBe(40);
  });
});
