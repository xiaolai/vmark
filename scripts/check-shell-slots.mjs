#!/usr/bin/env node
/**
 * Shell-surface identity gate — ADR-007 (WI-12).
 *
 * ADR-007 makes `src/shell/AppShell.tsx` the composition root and says "New
 * top-level surfaces (panels, overlays) become slot registrations, not edits to
 * `App.tsx`". There is no slot-REGISTRATION mechanism — a surface is mounted by
 * editing App.tsx's shell composition — so what this gate can honestly enforce
 * is narrower and checkable: the SET of surfaces App.tsx mounts changes only
 * with a deliberate, reviewable baseline edit.
 *
 * WHAT THIS REPLACED (WI-12). The previous gate counted a line-anchored NAME
 * regex — /^\s*<([A-Z][A-Za-z]*(?:Overlay|Panel|Dialog|Picker|Modal|Toast))[\s\/>]/gm
 * — against one integer budget. All three halves leaked:
 *   - name shape: `<CoherenceOverlays />` (plural), `<CommandPalette />`,
 *     `<QuickOpen />`, `<ContentSearch />`, `<EditorContextMenu />` carry the
 *     wrong suffix and were invisible;
 *   - line anchor: `sidePanel={<KnowledgeBaseOverlay />}` is not at line start,
 *     so the surface whose misplacement motivated the gate was the one surface
 *     it could not see;
 *   - counting: an integer permits a like-for-like swap (delete one surface,
 *     add another) with no change in the gate's verdict.
 * It saw 8 of the 20 surfaces App.tsx mounts. Renaming a component was enough to
 * leave the gate — the escape hatch WAS the enforcement mechanism.
 *
 * SURFACE — the definition enforced here (structural, never a name shape):
 *   A surface is a COMPONENT element (capitalised JSX tag) appearing anywhere
 *   inside the `<AppShell>` element of src/App.tsx — at any depth, in ANY prop
 *   or child. Deliberately not a fixed slot allowlist: adding a new slot must
 *   not create a place where a surface is invisible, which is the same class of
 *   hole the old regex had.
 *   The exclusions are ENUMERATED, never a namespace. Two kinds, each entry
 *   named so it shows up in a diff. The walk still RECURSES through all of
 *   them, so nesting a surface inside one does not hide it:
 *     1. TRANSPARENT_WRAPPERS — `Suspense`, `FeatureErrorBoundary`,
 *        `React.Fragment`: they render their children unchanged, so the surface
 *        is what is inside them, not the wrapper. Structural, not import-bound
 *        (`React.Fragment` is never imported by that name).
 *     2. NON_SURFACE_BINDINGS — three named bindings, each pinned to the module
 *        that must provide it: `EditorArea` from `@/shell` (ADR-007's shell
 *        layer IS the frame, and a frame is not a surface), and
 *        `DocumentWindowMount` + `MainWindowRunners` from `@/hooks/lifecycle`
 *        (both run effects and mount no UI of their own). Stated as WHAT THEY
 *        MOUNT, not as "both `return null`" — that wording was already false
 *        for `MainWindowRunners`, which returns a `React.ReactElement`, and a
 *        justification that is wrong about its own subject is worse than none.
 *        The exclusion has never keyed on the return type; it keys on the name
 *        and the module that must supply it.
 *
 *        This used to be "any binding imported from `@/shell` or `@/hooks`",
 *        which is a standing pre-approval for every future export of two large
 *        module trees — a `@/hooks/…` component that really does render would
 *        have been invisible, and so would a same-named impostor from anywhere
 *        under those prefixes. The allowlist is checked BOTH ways: an entry
 *        whose binding is no longer imported from its declared module fails the
 *        gate as a stale exclusion, because a dead exclusion is standing
 *        permission for whatever next claims that name.
 *   Lowercase tags are host elements and fragments have no tag; neither is a
 *   component. Detection is a real TypeScript parse, so a name in a comment, a
 *   string, or an import statement is prose, not a mount.
 *
 * The baseline is an IDENTITY LIST of names, never a count, and the comparison
 * runs both ways: an unlisted mounted surface fails, and a listed surface that
 * is no longer mounted also fails until its entry is deleted — otherwise a
 * removal silently becomes headroom for the next addition.
 *
 * The fix when it fires is not to append a name. Bundle related surfaces behind
 * one mount, the way `components/CoherenceOverlays.tsx` already does for the
 * coherence layer, or give the surface a real shell slot. A full-height docked
 * panel belongs in EditorArea's `sidePanel`, not in `overlays` — an overlay
 * occludes the editor.
 *
 * Usage:
 *   node scripts/check-shell-slots.mjs [--app <file>] [--baseline <file>]
 *   node scripts/check-shell-slots.mjs --write-baseline   (freeze reality)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

// ─── Pure, testable core ───

/** The composition root the walk starts from. Absent → the gate fails closed. */
const SHELL_ROOT_TAG = "AppShell";
/** Render-children-unchanged wrappers: recursed through, never recorded. */
const TRANSPARENT_WRAPPERS = new Set(["Suspense", "FeatureErrorBoundary", "React.Fragment"]);
/**
 * The complete list of bindings excluded because of what they are, each pinned
 * to the module that must supply it. Enumerated, never a namespace prefix — see
 * the header. Removing a mount means deleting its entry here too.
 */
const NON_SURFACE_BINDINGS = new Map([
  ["EditorArea", { module: "@/shell", why: "ADR-007 shell frame — a frame is not a surface" }],
  ["DocumentWindowMount", { module: "@/hooks/lifecycle", why: "runs effects; mounts no UI" }],
  ["MainWindowRunners", { module: "@/hooks/lifecycle", why: "runs effects; mounts no UI" }],
]);

/** Dotted name of a JSX tag, or null for namespaced/exotic tags. */
function jsxTagName(tagName) {
  if (ts.isIdentifier(tagName)) return tagName.text;
  if (ts.isPropertyAccessExpression(tagName)) {
    const left = jsxTagName(tagName.expression);
    return left === null ? null : `${left}.${tagName.name.text}`;
  }
  return null;
}

/** local binding name → module specifier, for every import in the file. */
function importMapOf(sourceFile) {
  const map = new Map();
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteralLike(stmt.moduleSpecifier)) continue;
    const spec = stmt.moduleSpecifier.text;
    const clause = stmt.importClause;
    if (!clause) continue;
    if (clause.name) map.set(clause.name.text, spec);
    const bindings = clause.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) map.set(bindings.name.text, spec);
    else for (const el of bindings.elements) map.set(el.name.text, spec);
  }
  return map;
}

/** Does `spec` name the module (or a subpath of it) an exclusion is pinned to? */
function providedBy(spec, module) {
  return spec === module || spec.startsWith(`${module}/`);
}

/** Allowlist entries whose binding this file no longer imports from its
 *  declared module — dead exclusions, which the gate refuses to carry. */
function staleExclusionsIn(imports) {
  const stale = [];
  for (const [name, { module }] of NON_SURFACE_BINDINGS) {
    const spec = imports.get(name);
    if (spec === undefined || !providedBy(spec, module)) {
      stale.push({ name, module, found: spec ?? null });
    }
  }
  return stale;
}

/**
 * Every surface mounted by the shell composition in `text` (sorted, unique),
 * plus any stale exclusion-allowlist entries.
 * Throws (fail closed) when the file does not parse or mounts no `<AppShell>`.
 */
export function extractShellSurfaces(text, label = "App.tsx") {
  const sf = ts.createSourceFile(label, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const parseErrors = sf.parseDiagnostics ?? [];
  if (parseErrors.length > 0) {
    const first = ts.flattenDiagnosticMessageText(parseErrors[0].messageText, " ");
    throw new Error(`${label} does not parse as TSX: ${first}`);
  }

  const roots = [];
  const findRoots = (node) => {
    if (ts.isJsxElement(node) && jsxTagName(node.openingElement.tagName) === SHELL_ROOT_TAG) {
      roots.push(node);
    } else if (ts.isJsxSelfClosingElement(node) && jsxTagName(node.tagName) === SHELL_ROOT_TAG) {
      roots.push(node);
    }
    ts.forEachChild(node, findRoots);
  };
  ts.forEachChild(sf, findRoots);

  if (roots.length === 0) {
    throw new Error(
      `${label} mounts no <${SHELL_ROOT_TAG}> element — the shell composition root ` +
        `moved or was renamed. The gate cannot enumerate surfaces and fails closed.`,
    );
  }

  const imports = importMapOf(sf);
  const surfaces = new Set();
  const record = (tagName) => {
    const name = jsxTagName(tagName);
    if (name === null || !/^[A-Z]/.test(name)) return; // host element / exotic tag
    if (name === SHELL_ROOT_TAG || TRANSPARENT_WRAPPERS.has(name)) return;
    const excluded = NON_SURFACE_BINDINGS.get(name.split(".")[0]);
    const spec = imports.get(name.split(".")[0]);
    // Both must hold: the NAME is allowlisted AND the module it came from is
    // the one the allowlist pinned it to. A same-named component from anywhere
    // else is an ordinary surface.
    if (excluded && spec !== undefined && providedBy(spec, excluded.module)) return;
    surfaces.add(name);
  };
  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) record(node.tagName);
    ts.forEachChild(node, visit);
  };
  for (const root of roots) ts.forEachChild(root, visit);

  return {
    surfaces: [...surfaces].sort((a, b) => a.localeCompare(b)),
    staleExclusions: staleExclusionsIn(imports),
  };
}

/** Fail loudly on malformed baseline data — a half-read baseline must never
 *  read as "no surfaces" (fail closed). */
export function validateBaseline(raw, label) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${label}: expected a JSON object with a "surfaces" array`);
  }
  if (!Array.isArray(raw.surfaces)) {
    throw new Error(`${label}: "surfaces" must be an array of component names`);
  }
  for (const name of raw.surfaces) {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(`${label}: malformed surface entry ${JSON.stringify(name)}`);
    }
  }
  const dupes = raw.surfaces.filter((n, i) => raw.surfaces.indexOf(n) !== i);
  if (dupes.length > 0) {
    throw new Error(`${label}: duplicate surface entr${dupes.length === 1 ? "y" : "ies"}: ${dupes.join(", ")}`);
  }
  return raw.surfaces;
}

/** Identity comparison — set difference in both directions. */
export function compareIdentities(actual, baseline) {
  const baseSet = new Set(baseline);
  const actualSet = new Set(actual);
  return {
    added: actual.filter((n) => !baseSet.has(n)),
    removed: baseline.filter((n) => !actualSet.has(n)),
  };
}

// ─── CLI shell ───

const BASELINE_HEADER = [
  "ADR-007 shell-surface identity list: every component mounted inside <AppShell> in src/App.tsx (any depth, any prop).",
  "Checked by scripts/check-shell-slots.mjs (pnpm lint:shell-slots, in check:all). An IDENTITY LIST, never a count — a count permits a like-for-like swap.",
  "Two-way ratchet: a mounted surface missing from this list fails the gate, and a listed surface that is no longer mounted also fails until its entry is deleted (record the win).",
  "Entries only get REMOVED, never added. To reduce the list, bundle related surfaces behind one mount (see src/components/CoherenceOverlays.tsx) or give the surface a real shell slot.",
  "Excluded by definition (see the script header): the Suspense/FeatureErrorBoundary/React.Fragment wrappers, and exactly three named bindings — EditorArea (@/shell frame), DocumentWindowMount and MainWindowRunners (@/hooks/lifecycle, both return null).",
];

function parseArgs(argv) {
  const args = { app: null, baseline: null, write: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--app") args.app = argv[++i];
    else if (argv[i] === "--baseline") args.baseline = argv[++i];
    else if (argv[i] === "--write-baseline") args.write = true;
    else {
      console.error(`❌ Unknown argument: ${argv[i]}`);
      process.exit(1);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const appPath = path.resolve(args.app ?? path.join(root, "src", "App.tsx"));
  const baselinePath = path.resolve(args.baseline ?? path.join(root, "scripts", "shell-slots-baseline.json"));

  let actual;
  let staleExclusions;
  try {
    ({ surfaces: actual, staleExclusions } = extractShellSurfaces(
      readFileSync(appPath, "utf8"),
      path.relative(root, appPath) || appPath,
    ));
  } catch (error) {
    console.error(`❌ Cannot enumerate shell surfaces (${appPath}): ${error.message}`);
    console.error("   The gate fails closed — fix the source, never weaken the gate to pass.");
    process.exit(1);
  }

  // Checked before anything else, including --write-baseline: a dead exclusion
  // must not be frozen into a fresh baseline as if it were still load-bearing.
  if (staleExclusions.length > 0) {
    console.error(`\n❌ ${staleExclusions.length} stale exclusion(s) in check-shell-slots.mjs:\n`);
    for (const { name, module, found } of staleExclusions) {
      console.error(
        `   ${name} — expected an import from ${module}, ` +
          (found === null ? "but it is not imported at all" : `but it is imported from ${found}`),
      );
    }
    console.error(
      "\n   NON_SURFACE_BINDINGS excludes these by name. An entry whose binding is\n" +
        "   gone is standing permission for whatever next claims that name — delete\n" +
        "   the entry in the same change that removed the mount.\n",
    );
    process.exit(1);
  }

  if (args.write) {
    writeFileSync(baselinePath, `${JSON.stringify({ "//": BASELINE_HEADER, surfaces: actual }, null, 2)}\n`);
    console.log(`✍️  Wrote ${actual.length} surface identit${actual.length === 1 ? "y" : "ies"} to ${baselinePath}`);
    return;
  }

  let baseline;
  try {
    baseline = validateBaseline(JSON.parse(readFileSync(baselinePath, "utf8")), baselinePath);
  } catch (error) {
    console.error(`❌ Cannot read shell-surface baseline (${baselinePath}): ${error.message}`);
    console.error("   The gate fails closed — fix the baseline, never delete it to pass.");
    process.exit(1);
  }

  const { added, removed } = compareIdentities(actual, baseline);

  if (added.length === 0 && removed.length === 0) {
    console.log(`✅ Shell-surface identity held (${actual.length} surfaces mounted in App.tsx, all baselined).`);
    return;
  }

  if (added.length > 0) {
    console.error(`\n❌ ADR-007: ${added.length} surface(s) mounted in App.tsx are NOT in the identity baseline:\n`);
    for (const name of added) console.error(`   ${name}`);
    console.error(
      "\n   Do NOT append the name to pass. Bundle related surfaces behind a single\n" +
        "   mount (see src/components/CoherenceOverlays.tsx) or register the surface\n" +
        "   as a shell slot. A full-height docked panel belongs in EditorArea's\n" +
        "   `sidePanel` slot, not in `overlays` — an overlay occludes the editor.\n",
    );
  }

  if (removed.length > 0) {
    console.error(`\n❌ ${removed.length} baselined surface(s) are no longer mounted — record the win:\n`);
    for (const name of removed) console.error(`   ${name}`);
    console.error(
      "\n   Delete these entries from scripts/shell-slots-baseline.json so the\n" +
        "   improvement cannot silently become headroom for the next addition.\n",
    );
  }

  process.exit(1);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
