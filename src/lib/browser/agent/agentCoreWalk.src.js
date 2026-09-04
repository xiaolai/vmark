// agentCoreWalk.src.js — the composed walk of the shared page-world core
// (audit 2026-09-03, S-02 / #103). Concatenated straight after `agentCore.src.js`
// and before `agentCoreRoles.src.js` by every host (`agentCore.ts` for the agent
// library and the tests, `recorder_shim_macos.rs` for the recorder shim); the same
// discipline applies — `__vmark`-prefixed function declarations only, ES5, nothing
// a page can observe until a call — and it is pinned by the same tests. Split from
// the core when that file crossed the size limit; the seam is the one between
// perceiving an element and enumerating them.

/** The composed walk every perception path runs on: each element under `root` (a
 *  Document, ShadowRoot or Element; root itself excluded) in composed pre-order —
 *  an element, then its OPEN shadow tree, then its light children (S-05) — is
 *  handed to `visit`. Lazy in both dimensions (#103): a cursor per open node reads
 *  children by index (a node a billion wide costs one cursor) and the walk stops
 *  after `budget` visited elements, returning true when it ran out with elements
 *  still unvisited so a consumer can say its answer is incomplete. Closed roots are
 *  invisible by definition — `__vmarkCountUnreachable` tallies what it cannot enter. */
function __vmarkWalk(root, budget, visit) {
  var visited = 0, stack = [{ kids: (root || document).children, i: 0 }];
  while (stack.length) {
    var top = stack[stack.length - 1];
    if (!top.kids || top.i >= top.kids.length) { stack.pop(); continue; }
    var el = top.kids[top.i++];
    if (++visited > budget) return true;
    visit(el);
    stack.push({ kids: el.children, i: 0 });
    var sr = null;
    try { sr = el.shadowRoot; } catch (e) {}
    if (sr) stack.push({ kids: sr.children, i: 0 });
  }
  return false;
}

/** Every element the budgeted walk reaches under `root`, as a list, for the
 *  consumers that need one (`gateScript`, `interactScript`, `__vmarkPageText`) —
 *  at most `__vmarkVisitBudget()` long, never the whole of a hostile page. */
function __vmarkAll(root) {
  var out = [];
  __vmarkWalk(root, __vmarkVisitBudget(), function (el) { out.push(el); });
  return out;
}

/** Tally into `counts` ({closedShadowRoots, frames}) what the composed walk could
 *  not enter at `el`, so the model knows the snapshot is not the whole page: a
 *  frame (evals target the main frame only), or a custom-element host exposing no
 *  open shadow root — where a closed root hides. A closed root cannot be observed
 *  from outside, so `closedShadowRoots` is a proxy, not a count: a light-DOM custom
 *  element is counted too, a plain `<div>` hosting a closed root is not. Per
 *  element, so a walk tallies as it goes with no element list. */
function __vmarkCountUnreachable(counts, el) {
  var t = String(el.tagName || "").toLowerCase();
  if (t === "iframe" || t === "frame") counts.frames++;
  else if (t.indexOf("-") > 0 && !el.shadowRoot) counts.closedShadowRoots++;
}

/** The tally over an element list (what `__vmarkAll` returns). */
function __vmarkUnreachable(all) {
  var counts = { closedShadowRoots: 0, frames: 0 };
  for (var i = 0; i < all.length; i++) __vmarkCountUnreachable(counts, all[i]);
  return counts;
}
