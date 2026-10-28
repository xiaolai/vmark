/**
 * Journey: focus-facts-wkwebview  (WI-AL3.2 · comments panel focus model)
 *
 * The comments panel's focus model rests on WebKit focus facts measured in
 * Playwright's WebKit (`src/test/focusFacts.webkit.test.ts`), chiefly when a
 * focused control that becomes disabled loses focus: the two-frame confirm is
 * sized to that delayed blur. The app runs in WKWebView, not Playwright's
 * WebKit build, so the same facts are held here, in the app's own webview.
 *
 * How: the dev server serves `src/test/focusFacts.ts`, so the page imports the
 * very table both vitest runners register and runs each case through
 * `openFactHost`/`closeFactHost` with the same two-frame `settle`. Facts marked
 * `pointer` need a real mouse; a script can only dispatch synthetic events,
 * which do not move focus the way a click does, so they are not run here and
 * stay with the Playwright runner.
 *
 * Asserts: the window has focus (a background window delivers no blur); every
 * fact not marked `pointer` passes; exactly the five pointer facts were left out.
 */

import { evalJs } from "../lib/bridge.mjs";

const POINTER_FACTS = 5;

const RUN_FACTS = `(async () => {
  if (!document.hasFocus()) return { unfocused: true };
  const { FOCUS_FACTS } = await import("/src/test/focusFacts.ts");
  const { openFactHost, closeFactHost } = await import("/src/test/focusFactHost.ts");
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const engine = {
    name: "WKWebView",
    clickFocusesButton: false,
    click: async () => { throw new Error("a pointer fact reached the in-app runner"); },
    settle: async () => { await frame(); await frame(); },
  };
  const results = [];
  for (const fact of FOCUS_FACTS) {
    if (fact.pointer) { results.push({ name: fact.name, skipped: true }); continue; }
    openFactHost();
    try {
      await fact.run(engine);
      results.push({ name: fact.name, ok: true });
    } catch (e) {
      results.push({ name: fact.name, ok: false, error: String(e && e.message || e).slice(0, 600) });
    } finally {
      closeFactHost();
    }
  }
  return { results };
})()`;

export default {
  name: "focus-facts-wkwebview",
  platforms: ["darwin"],
  coverageRequired: true,

  async run(client, ctx) {
    const out = await evalJs(client, RUN_FACTS, 60000);
    if (out?.unfocused) throw new Error("the main window does not have focus, so WKWebView delivers no blur; focus the app window and rerun");
    const results = out?.results;
    if (!Array.isArray(results) || results.length === 0) throw new Error(`no fact results came back: ${JSON.stringify(out)}`);

    const skipped = results.filter((r) => r.skipped);
    const failed = results.filter((r) => r.ok === false);
    const passed = results.filter((r) => r.ok === true);
    for (const r of passed) ctx.log(`held: ${r.name}`);
    if (failed.length > 0) {
      throw new Error(`WKWebView disagrees with the measured focus facts:\n${failed.map((r) => `  ${r.name}\n    ${r.error}`).join("\n")}`);
    }
    if (skipped.length !== POINTER_FACTS) {
      throw new Error(`expected ${POINTER_FACTS} pointer facts left out, got ${skipped.length}: ${skipped.map((r) => r.name).join("; ")}`);
    }
    ctx.log(`${passed.length} facts held in WKWebView; ${skipped.length} pointer facts left to the Playwright runner`);
  },
};
