/**
 * Focus facts — the WebKit focus behaviours the comments panel's focus model
 * relies on, written once as a spec that runs against any engine: real WebKit
 * with a real pointer, and jsdom with the WebKit focus model installed. A fact
 * the two disagree on fails one of the two runs.
 *
 * The facts are a table (`FOCUS_FACTS`) each runner registers with
 * `it.each`, so the cases are declared in the runner file itself.
 *
 * Each case compares one observation record (where focus is, how many
 * `focusout` events fired, the order events arrived in), so a failure prints
 * what the engine did. The traces pin order, not only outcome: a model that
 * reaches the right focus by a different sequence of events fails them.
 *
 * @coordinates-with test/focusFacts.webkit.test.ts — the measurement in real WebKit
 * @coordinates-with test/focusFactHost.ts — the fixture each case runs in
 * @coordinates-with test/webkitFocusModel.ts — the jsdom model held to the same facts
 * @module test/focusFacts
 */
import { expect } from "vitest";
import { add, afterFrame, countFocusOut, factHost, mountBusy, record, where } from "./focusFactHost";

/**
 * Whether a mouse click focuses the clicked button in the WebKit this runs in.
 * macOS WebKit (WKWebView, Safari) focuses nothing on a click; Linux WebKit
 * (WebKitGTK, and the Playwright WebKit on CI's Ubuntu runner) focuses the
 * button, measured on that runner: focus ended on the clicked button, with a
 * `focusin` between the previous owner's `focusout` and the `pointerup`.
 */
export function webkitClickFocusesButton(): boolean {
  return !navigator.platform.startsWith("Mac");
}

export interface FocusEngine {
  name: string;
  /** A mouse click focuses the clicked button (see `webkitClickFocusesButton`). */
  clickFocusesButton: boolean;
  /** A mouse click on `el`, as the engine delivers one. */
  click(el: HTMLElement): Promise<void>;
  /** Let deferred focus work (blur of a disabled control) happen. */
  settle(): Promise<void>;
}

export interface FocusFact {
  name: string;
  /** The case needs a real pointer: a runner that can only dispatch synthetic events does not run it. */
  pointer?: true;
  run(engine: FocusEngine): Promise<void>;
}

/** The facts, in the order they run. */
export const FOCUS_FACTS: readonly FocusFact[] = [
  {
    name: "F1: a mouse click focuses the clicked button only where the platform does",
    pointer: true,
    run: async (engine) => {
      const b = add("button", "b");
      await engine.click(b);
      await engine.settle();
      expect({ focus: where() }).toEqual({ focus: engine.clickFocusesButton ? "b" : "body" });
    },
  },
  {
    name: "F2 and F2b: a focused button that becomes disabled falls to the page, with a focusout",
    run: async (engine) => {
      const b = add("button", "b");
      b.focus();
      expect(where()).toBe("b");
      const out = countFocusOut(b);
      b.disabled = true;
      await engine.settle();
      expect({ focus: where(), focusout: out.n }).toEqual({ focus: "body", focusout: 1 });
    },
  },
  {
    name: "F3: a mouse click elsewhere moves focus from a focused textarea to the page or the clicked button, with a focusout",
    pointer: true,
    run: async (engine) => {
      const area = add("textarea", "area");
      const other = add("button", "other");
      area.focus();
      expect(where()).toBe("area");
      const out = countFocusOut(area);
      await engine.click(other);
      await engine.settle();
      expect({ focus: where(), focusout: out.n }).toEqual({ focus: engine.clickFocusesButton ? "other" : "body", focusout: 1 });
    },
  },
  {
    name: "F3b: a mouse click elsewhere moves focus from a focused button to the page or the clicked button, with a focusout",
    pointer: true,
    run: async (engine) => {
      const b = add("button", "b");
      const other = add("button", "other");
      b.focus();
      expect(where()).toBe("b");
      const out = countFocusOut(b);
      await engine.click(other);
      await engine.settle();
      expect({ focus: where(), focusout: out.n }).toEqual({ focus: engine.clickFocusesButton ? "other" : "body", focusout: 1 });
    },
  },
  {
    name: "F3c: a mouse click elsewhere moves focus from a focused button just disabled to the page or the clicked button, with one focusout",
    pointer: true,
    run: async (engine) => {
      const b = add("button", "b");
      const other = add("button", "other");
      b.focus();
      const out = countFocusOut(b);
      b.disabled = true;
      await engine.click(other);
      await engine.settle();
      expect({ focus: where(), focusout: out.n }).toEqual({ focus: engine.clickFocusesButton ? "other" : "body", focusout: 1 });
    },
  },
  {
    name: "F4: focus() on a disabled button does nothing",
    run: async (engine) => {
      const b = add("button", "b");
      b.disabled = true;
      b.focus();
      await engine.settle();
      expect({ focus: where() }).toEqual({ focus: "body" });
    },
  },
  {
    name: "F2c: a focused button disabled and re-enabled in the same task keeps focus",
    run: async (engine) => {
      await afterFrame();
      const b = add("button", "b");
      b.focus();
      const out = countFocusOut(b);
      b.disabled = true;
      b.disabled = false;
      await engine.settle();
      expect({ focus: where(), focusout: out.n }).toEqual({ focus: "b", focusout: 0 });
    },
  },
  {
    name: "F2c: a focused button disabled, then re-enabled in the next task before a frame, keeps focus",
    run: async (engine) => {
      await afterFrame();
      const b = add("button", "b");
      b.focus();
      const out = countFocusOut(b);
      let frames = 0;
      requestAnimationFrame(() => frames++);
      b.disabled = true;
      await new Promise((resolve) => setTimeout(resolve, 0));
      const framesBetween = frames;
      b.disabled = false;
      await engine.settle();
      expect({ framesBetween, focus: where(), focusout: out.n }).toEqual({ framesBetween: 0, focus: "b", focusout: 0 });
    },
  },
  {
    name: "F2c: a focused button disabled by a React commit and re-enabled from its layout effect keeps focus",
    run: async (engine) => {
      await afterFrame();
      const { b, log, root, set } = mountBusy(true);
      const out = countFocusOut(b);
      set(true);
      await engine.settle();
      expect({ focus: where(), focusout: out.n, log }).toEqual({ focus: "b", focusout: 0, log: ["layoutEffect busy=true", "layoutEffect busy=false"] });
      root.unmount();
    },
  },
  {
    name: "F5b: removing the focused textarea moves focus to the page with no focusout",
    run: async (engine) => {
      const area = add("textarea", "area");
      area.focus();
      const out = countFocusOut(area);
      area.remove();
      await engine.settle();
      expect({ focus: where(), focusout: out.n }).toEqual({ focus: "body", focusout: 0 });
    },
  },
  {
    name: "F5c: removing a focused textarea mid-composition fires no compositionend, blur or focusout",
    run: async (engine) => {
      const area = add("textarea", "area");
      area.focus();
      const log: string[] = [];
      record(document, ["compositionstart", "compositionupdate", "compositionend", "input", "blur", "focusout"], log);
      area.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      area.remove();
      await engine.settle();
      expect({ focus: where(), log }).toEqual({ focus: "body", log: ["compositionstart@area"] });
    },
  },
  {
    name: "trace: the disable path — the blur lands in the next rendering update, after its frame callbacks",
    run: async (engine) => {
      await afterFrame();
      const { log, root, set } = mountBusy(false);
      const observer = new MutationObserver(() => log.push("mutationObserver"));
      observer.observe(factHost(), { attributes: true, attributeFilter: ["disabled"], subtree: true });
      record(document, ["blur", "focusout"], log);
      requestAnimationFrame(() => log.push("rAF"));
      set(true);
      log.push("commit returned");
      await engine.settle();
      observer.disconnect();
      root.unmount();
      expect({ focus: where(), log }).toEqual({
        focus: "body",
        log: ["layoutEffect busy=true", "commit returned", "mutationObserver", "rAF", "blur@b", "focusout@b"],
      });
    },
  },
  {
    name: "trace: a disable made while a frame is under way loses focus in that same frame",
    run: async (engine) => {
      await afterFrame();
      const b = add("button", "b");
      b.focus();
      const log: string[] = [];
      record(document, ["blur", "focusout"], log);
      const second = new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          log.push("rAF 1");
          void Promise.resolve().then(() => {
            b.disabled = true;
            log.push("disabled");
            requestAnimationFrame(() => {
              log.push("rAF 2");
              resolve();
            });
          });
        });
      });
      await second;
      await engine.settle();
      expect({ focus: where(), log }).toEqual({ focus: "body", log: ["rAF 1", "disabled", "blur@b", "focusout@b", "rAF 2"] });
    },
  },
  {
    name: "trace: the click path, from a focused button to a click on another",
    pointer: true,
    run: async (engine) => {
      const b = add("button", "b");
      const other = add("button", "other");
      b.focus();
      const log: string[] = [];
      record(document, ["pointerdown", "mousedown", "blur", "focusout", "focusin", "pointerup", "mouseup", "click"], log);
      await engine.click(other);
      await engine.settle();
      const focusin = engine.clickFocusesButton ? ["focusin@other"] : [];
      expect({ focus: where(), log }).toEqual({
        focus: engine.clickFocusesButton ? "other" : "body",
        log: ["pointerdown@other", "mousedown@other", "blur@b", "focusout@b", ...focusin, "pointerup@other", "mouseup@other", "click@other"],
      });
    },
  },
  {
    name: "F5: removing the focused button moves focus to the page with no focusout",
    run: async (engine) => {
      const b = add("button", "b");
      b.focus();
      expect(where()).toBe("b");
      const out = countFocusOut(b);
      b.remove();
      await engine.settle();
      expect({ focus: where(), focusout: out.n }).toEqual({ focus: "body", focusout: 0 });
    },
  },
];
