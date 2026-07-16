#!/usr/bin/env node
// WI-P0.3 probe — stable element refs backed by an isolated-world WeakMap.
//
// Question: can the driver assign each snapshotted element a ref (`e1`, `e2`, …)
// that is STABLE across repeated reads within one committed page, yet cannot
// leak across a navigation (a new document → the world is torn down → a fresh
// ref store)? This validates ADR-A2 before Phase 2 productionizes it in
// `src/lib/browser/agent/refs.ts`.
//
// The mechanism probed here is exactly what will run inside `WKContentWorld`:
// a module-scoped `WeakMap<Element,string>` + a monotonic counter, reset when
// the content world is recreated on navigation. jsdom stands in for the DOM.
//
// Run: node dev-docs/grills/browser-automation/probe-refs.mjs
// Exit 0 = PASS (all assertions hold), 1 = FAIL.

import { JSDOM } from "jsdom";

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  PASS ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    failures += 1;
  }
}

/** A ref store scoped to one content world (one committed page). */
function makeRefStore() {
  const refs = new WeakMap();
  const byRef = new Map();
  let counter = 0;
  return {
    refFor(el) {
      const existing = refs.get(el);
      if (existing) return existing;
      const ref = `e${(counter += 1)}`;
      refs.set(el, ref);
      byRef.set(ref, el);
      return ref;
    },
    queryByRef(ref) {
      const el = byRef.get(ref);
      // A ref whose element left the document no longer resolves — mirrors the
      // driver refusing to act on a detached handle.
      if (!el || !el.isConnected) return null;
      return el;
    },
  };
}

function main() {
  // ── One committed page: refs are stable across repeated snapshots ────────
  const page1 = new JSDOM(
    `<!doctype html><body>
       <button id="a">Publish</button>
       <button id="b">Save draft</button>
       <a id="c" href="/x">Learn more</a>
     </body>`,
  );
  const doc1 = page1.window.document;
  const store1 = makeRefStore();

  const a = doc1.getElementById("a");
  const b = doc1.getElementById("b");
  const c = doc1.getElementById("c");

  // First snapshot pass.
  const pass1 = [a, b, c].map((el) => store1.refFor(el));
  // Second snapshot pass over the SAME page.
  const pass2 = [a, b, c].map((el) => store1.refFor(el));

  check("refs are assigned in document order (e1,e2,e3)", pass1.join(",") === "e1,e2,e3");
  check("each element keeps its ref across repeated reads", pass1.join(",") === pass2.join(","));
  check("distinct elements get distinct refs", new Set(pass1).size === 3);
  check("queryByRef resolves a ref back to its element", store1.queryByRef("e1") === a);
  check("queryByRef returns null for an unknown ref", store1.queryByRef("e99") === null);

  // A detached element's ref no longer resolves (act on a stale handle refused).
  b.remove();
  check("queryByRef returns null once the element leaves the document", store1.queryByRef("e2") === null);

  // ── Navigation → a fresh world → a fresh ref store: no cross-page leak ────
  const page2 = new JSDOM(`<!doctype html><body><button id="z">Delete</button></body>`);
  const doc2 = page2.window.document;
  const store2 = makeRefStore();
  const z = doc2.getElementById("z");
  const refZ = store2.refFor(z);

  check("a new page's ref store restarts at e1 (counter did not leak)", refZ === "e1");
  check("a ref minted on the old page does not resolve in the new store", store2.queryByRef("e1") === z);
  check("the old store cannot resolve the new page's element", store1.queryByRef("e1") === a);

  console.log("");
  if (failures === 0) {
    console.log("probe-refs: PASS (all assertions held)");
    process.exit(0);
  }
  console.log(`probe-refs: FAIL (${failures} assertion(s) failed)`);
  process.exit(1);
}

main();
