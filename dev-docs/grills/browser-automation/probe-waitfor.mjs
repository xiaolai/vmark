#!/usr/bin/env node
// WI-P0.4 probe — a bounded `wait_for` observer that resolves on match and
// TEARS DOWN on timeout (no leaked MutationObserver, no leaked timer).
//
// Question: can the driver block until an element/text appears (or a timeout),
// running a MutationObserver in the isolated content world, and be guaranteed to
// disconnect the observer and clear the timer on every exit path — match,
// timeout, and initial-hit? A leaked observer would keep firing against a page
// the driver has moved on from. This validates ADR-A3 before Phase 3
// productionizes it in `src/lib/browser/agent/waitFor.ts`.
//
// Run: node dev-docs/grills/browser-automation/probe-waitfor.mjs
// Exit 0 = PASS, 1 = FAIL.

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

/**
 * Wait until `predicate(root)` is truthy, or `timeoutMs` elapses. Resolves
 * `{ matched, disconnected }`. `disconnected` records that the observer was
 * torn down — the invariant the probe checks.
 *
 * `ObserverCtor` is injected so the probe can count live observers; in
 * production it is the page's `MutationObserver`.
 */
function waitForCondition(root, predicate, timeoutMs, ObserverCtor, now) {
  return new Promise((resolve) => {
    let settled = false;
    let observer = null;
    let timer = null;

    const finish = (matched) => {
      if (settled) return;
      settled = true;
      if (observer) observer.disconnect();
      if (timer !== null) clearTimeout(timer);
      resolve({ matched, disconnected: true });
    };

    // Initial check — the condition may already hold, in which case no observer
    // should linger.
    if (predicate(root)) {
      finish(true);
      return;
    }

    observer = new ObserverCtor(() => {
      if (predicate(root)) finish(true);
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });

    timer = setTimeout(() => finish(false), timeoutMs);
    void now;
  });
}

async function main() {
  const dom = new JSDOM(`<!doctype html><body><main></main></body>`);
  const { document, MutationObserver } = dom.window;

  // Count how many observers are currently connected, so a leak is observable.
  let liveObservers = 0;
  class CountingObserver extends MutationObserver {
    constructor(cb) {
      super(cb);
      this._connected = false;
    }
    observe(...args) {
      if (!this._connected) {
        this._connected = true;
        liveObservers += 1;
      }
      return super.observe(...args);
    }
    disconnect() {
      if (this._connected) {
        this._connected = false;
        liveObservers -= 1;
      }
      return super.disconnect();
    }
  }

  const main = document.querySelector("main");
  const hasHeading = (root) => !!root.querySelector("h1");

  // ── Case A: condition already true → immediate match, no lingering observer.
  const already = document.createElement("h1");
  already.textContent = "Loaded";
  main.appendChild(already);
  const a = await waitForCondition(main, hasHeading, 1000, CountingObserver);
  check("A: an already-satisfied condition resolves matched=true", a.matched === true);
  check("A: no observer is left connected on the initial-hit path", liveObservers === 0);
  already.remove();

  // ── Case B: condition becomes true after a mutation → match, then teardown.
  const bPromise = waitForCondition(main, hasHeading, 1000, CountingObserver);
  check("B: observer is connected while waiting", liveObservers === 1);
  setTimeout(() => {
    const h = document.createElement("h1");
    h.textContent = "Arrived";
    main.appendChild(h);
  }, 20);
  const b = await bPromise;
  check("B: a mutation that satisfies the condition resolves matched=true", b.matched === true);
  check("B: the observer is disconnected after a match", liveObservers === 0);
  main.querySelector("h1")?.remove();

  // ── Case C: condition never becomes true → timeout, and teardown anyway.
  const cPromise = waitForCondition(main, () => !!main.querySelector("form"), 60, CountingObserver);
  check("C: observer is connected during the wait", liveObservers === 1);
  const c = await cPromise;
  check("C: an unmet condition resolves matched=false on timeout", c.matched === false);
  check("C: the observer is disconnected on the timeout path (no leak)", liveObservers === 0);

  console.log("");
  if (failures === 0) {
    console.log("probe-waitfor: PASS (all assertions held)");
    process.exit(0);
  }
  console.log(`probe-waitfor: FAIL (${failures} assertion(s) failed)`);
  process.exit(1);
}

main();
