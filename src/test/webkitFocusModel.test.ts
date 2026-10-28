// WI-AL3.2 — jsdom with the WebKit focus model installed obeys the same focus facts measured in real WebKit: a click focuses nothing, a focused button that becomes disabled falls to the page with a focusout at the end of the next modelled frame (after its animation-frame callbacks) unless re-enabled first, a click elsewhere takes focus to the page with a focusout, focus() on a disabled button does nothing, and removing the focused element fires no focusout; a fact is marked pointer exactly when it clicks, so the in-app WKWebView runner skips only those
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// timer-isolation: intentional real timers — the model is a frame clock built on timers, held to the same facts the real-WebKit runner measures on real time; uninstall clears its pending frame.
import { useFocusFactHost } from "./focusFactHost";
import { FOCUS_FACTS, type FocusEngine } from "./focusFacts";
import { installWebKitFocusModel, mouseClick, nextFrame } from "./webkitFocusModel";

let uninstall: () => void = () => undefined;
beforeEach(() => {
  uninstall = installWebKitFocusModel();
});
afterEach(() => uninstall());

const engine: FocusEngine = {
  name: "jsdom with the WebKit focus model",
  // The model is of macOS WKWebView, the primary platform.
  clickFocusesButton: false,
  click: async (el) => mouseClick(el),
  settle: nextFrame,
};

describe(`focus facts (${engine.name})`, () => {
  useFocusFactHost();
  it.each(FOCUS_FACTS)("$name", (fact) => fact.run(engine));

  // The in-app runner skips exactly the facts marked `pointer`: an unmarked
  // fact that clicks would fail there, a marked one that does not would go unmeasured.
  it.each(FOCUS_FACTS)("$name is marked pointer exactly when it clicks", async (fact) => {
    let clicks = 0;
    await fact.run({ ...engine, click: async (el) => (clicks++, engine.click(el)) });
    expect({ pointer: fact.pointer === true }).toEqual({ pointer: clicks > 0 });
  });
});
