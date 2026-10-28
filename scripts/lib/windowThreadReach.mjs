/**
 * Which `#[tauri::command]` functions can reach a window builder, and which of
 * them run on the main thread — the decision half of the window-thread gate.
 *
 * Purpose: given the fns `windowThreadParse.mjs` produced, walk call edges by
 * name (visibility-aware) from every builder site and report the synchronous
 * commands that reach one. The reasoning behind each rule is in the header of
 * `scripts/check-window-creation-thread.mjs`.
 *
 * @coordinates-with scripts/check-window-creation-thread.mjs — the gate (CLI) that re-exports this
 * @coordinates-with scripts/lib/windowThreadParse.mjs — produces the fns walked here
 * @module scripts/lib/windowThreadReach
 */

/** The call that actually creates a native window + webview. */
export const WINDOW_BUILDER = "WebviewWindowBuilder::new";

/**
 * Every constructor that hands tao/wry a window to create, and therefore every
 * seed for the reachability walk.
 *
 * ONE hardcoded `WebviewWindowBuilder::new` substring was the whole detector,
 * and it fails OPEN in a way `seedCount` cannot see: the existing sites keep
 * the count non-zero, so a NEW site built through `WindowBuilder::new` (a
 * window with no webview), `WebviewBuilder::new` (a webview added to an
 * existing window) or `…::from_config` is simply not a seed, and every command
 * reaching it passes. A turbofish between the type and the
 * constructor (`WebviewWindowBuilder::<R>::new`) defeated the substring too.
 *
 * The word boundary matters: `\bWindowBuilder` must not match inside
 * `WebviewWindowBuilder`, or the two names would double-count the same site.
 */
const BUILDER_TYPES = ["WebviewWindowBuilder", "WindowBuilder", "WebviewBuilder"];
const BUILDER_CTORS = ["new", "from_config"];
export const WINDOW_BUILDER_CALL = new RegExp(
  `\\b(?:${BUILDER_TYPES.join("|")})\\s*(?:::\\s*<[^>]*>\\s*)?::\\s*(?:${BUILDER_CTORS.join("|")})\\s*\\(`,
);

/**
 * An ALIAS import of a window builder (`use tauri::WebviewWindowBuilder as W;`).
 *
 * The gate resolves calls by NAME, so it cannot follow one. Rather than fail
 * open on the rename, it refuses: the alias is reported and the gate exits
 * non-zero, which is the loud half of the same property `seedCount` protects.
 */
export const BUILDER_ALIAS = new RegExp(
  `\\b(?:${BUILDER_TYPES.join("|")})\\s+as\\s+([A-Za-z_][A-Za-z0-9_]*)`,
);

/** Per-command opt-out; the trailing reason is required. */
export const OK_MARKER = /\/\/\s*window-thread-ok:\s*(\S.*)$/m;
const BARE_MARKER = /\/\/\s*window-thread-ok:?\s*$/m;

/**
 * Does `caller` call `callee`, as far as names can tell?
 *
 * Two forms, and the difference is the second false-positive class this gate
 * has had to answer. Within one FILE any spelling counts: the author can see
 * both definitions, and a local method and a local free function sharing a
 * name is not how this goes wrong. ACROSS files a receiver call — `x.name(`
 * — does not count, because the receiver decides which type's method runs and
 * this scan does not know types. `pdf_export::renderer::sink` gained a
 * `pub(super) fn settle` while `browser::nav_kvo_macos` calls `owned.settle(…)`
 * on something else entirely; with `\b` those two were ONE edge, and through
 * it the reachable set grew to include `read_workspace_config`,
 * `update_recent_files` and five more commands that touch no window at all.
 * Seven findings, every one false, and the "fix" they asked for was making
 * seven unrelated commands async — which `AGENTS.md` records as its own
 * hazard, since going async removes serialization the blocking IPC loop
 * provided.
 *
 * A path-qualified call (`module::name(`, `Type::name(`) still counts across
 * files, within the limits `siteReaches` sets (a separate binary crate, a std
 * path, or a different known type never reaches): `::` is not a receiver.
 * What is given up is a window-creating METHOD
 * reached from another file through a value — none exists here (every builder
 * site is a free function, and `check-window-creation-thread.test.mjs` pins
 * that all seven #1301 commands are still caught by this rule).
 */
/**
 * Does `caller` bind `name` itself — as a parameter, or as a `let`?
 *
 * Either shadows a crate item of the same name for the whole body, so a bare
 * `name(...)` there is the LOCAL callable, not the item.
 */
function bindsLocally(caller, name) {
  const param = new RegExp(`(^|[(,\\s])${name}\\s*:`);
  const binding = new RegExp(`\\blet\\s+(?:mut\\s+)?${name}\\b`);
  return param.test(caller.params) || binding.test(caller.body);
}

/**
 * The crate a file compiles into: each `src/bin/<target>` (file or folder) is
 * its own binary crate; everything else is the library.
 */
function crateOf(file) {
  const m = file.match(/(?:^|\/)src\/bin\/([^/]+?)(?:\.rs$|\/)/);
  return m ? `bin:${m[1]}` : "lib";
}

/** Path roots that never lead into this crate's items. */
const FOREIGN_ROOTS = new Set(["std", "core", "alloc"]);

/**
 * Every call site of `name` in `body` with its path segments: `a::b::name(` →
 * `["a", "b"]`, a bare `name(` → `[]`. A receiver call (`x.name(`) is not a
 * call site here; the same-file branch handles those.
 */
function callSites(body, name) {
  const re = new RegExp(`(?<![.\\w:])((?:[A-Za-z_]\\w*\\s*::\\s*)*)${name}\\s*(?:::\\s*<[^>]*>\\s*)?\\(`, "g");
  return [...body.matchAll(re)].map((m) => m[1].split("::").map((x) => x.trim()).filter(Boolean));
}

/**
 * Can this call site, written in `caller`, name `callee` in another file?
 *
 * FOURTH instance of the name-collision class, so the walk now refuses the
 * spellings Rust itself would never resolve to `callee`, and nothing else.
 * Live false edges this removes: a bare `publish(tokens)` matched to
 * `HeldDir::publish` (an impl item is never reachable bare),
 * `std::mem::replace(…)` matched to `HeldDir::replace`, `anchored::HeldDir::open`
 * matched to another type's `open`, and a bare call to a file's OWN free
 * `apply` matched to another module's `apply`.
 *
 * Module segments are NOT checked: `#[path]` remaps files to other module
 * names and parents re-export children (`window_manager::create_document_window…`
 * lives in `document_windows.rs`), so a file stem says nothing reliable. A type
 * segment refuses only when it names a DIFFERENT type or trait this crate
 * implements; an unknown one (a generic, an alias, an external type) keeps the
 * edge, so the gate fails closed.
 */
function siteReaches(segs, caller, callee, ctx) {
  if (segs.length === 0) {
    if (callee.implType) return false;
    if (bindsLocally(caller, callee.name)) return false;
    return !ctx.freeNames.get(caller.file)?.has(callee.name);
  }
  if (FOREIGN_ROOTS.has(segs[0])) return false;
  const last = segs[segs.length - 1];
  if (!/^[A-Z]/.test(last) || last === "Self") return true;
  if (last === callee.implType || last === callee.implTrait) return true;
  return !ctx.implNames.has(last);
}

function callsByName(caller, callee, ctx) {
  // A library item cannot call into a `src/bin` target (a separate crate):
  // `bin/pdf_smoke`'s `run`, which drives the PDF window, was reached that way.
  if (crateOf(callee.file) !== "lib" && crateOf(callee.file) !== crateOf(caller.file)) return false;
  if (caller.file === callee.file) {
    return new RegExp(`\\b${callee.name}\\s*(?:::\\s*<[^>]*>\\s*)?\\(`).test(caller.body);
  }
  // A caller that BINDS the name locally (a closure parameter, a `let`) cannot
  // reach the crate item through a bare call — `siteReaches` refuses that
  // spelling; `dock_recent.rs`'s `register(path)` was the live case.
  return callSites(caller.body, callee.name).some((segs) => siteReaches(segs, caller, callee, ctx));
}

/** Does this body construct a window? */
export const buildsWindow = (fn) => WINDOW_BUILDER_CALL.test(fn.body);

/** Ids of every fn that can reach a window builder, transitively. */
export function reachableWindowCreators(fns) {
  const reach = new Set(fns.filter(buildsWindow).map((f) => f.id));
  const freeNames = new Map();
  for (const f of fns) if (!f.implType) (freeNames.get(f.file) ?? freeNames.set(f.file, new Set()).get(f.file)).add(f.name);
  const implNames = new Set(fns.flatMap((f) => [f.implType, f.implTrait]).filter(Boolean));
  const ctx = { freeNames, implNames };
  let changed = true;
  while (changed) {
    changed = false;
    for (const caller of fns) {
      if (reach.has(caller.id)) continue;
      for (const callee of fns) {
        if (!reach.has(callee.id)) continue;
        // A private callee is only visible inside its own module (= its file).
        if (!callee.crateVisible && callee.file !== caller.file) continue;
        if (callsByName(caller, callee, ctx)) { reach.add(caller.id); changed = true; break; }
      }
    }
  }
  return reach;
}

/** Commands that create a window on the main thread, plus bare-marker abuses. */
export function findings(fns) {
  const reach = reachableWindowCreators(fns);
  const violations = [];
  const bareMarkers = [];
  for (const fn of fns) {
    if (BARE_MARKER.test(fn.rawBody) && !OK_MARKER.test(fn.rawBody)) bareMarkers.push(fn);
    if (!fn.isCommand || !reach.has(fn.id)) continue;
    if (fn.isAsync || /\basync\b/.test(fn.attrArgs)) continue;
    if (OK_MARKER.test(fn.rawBody)) continue;
    violations.push(fn);
  }
  return { violations, bareMarkers, seedCount: fns.filter(buildsWindow).length };
}
