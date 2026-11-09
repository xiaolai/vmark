/**
 * Label parity: ONE label per command. The native menu's en.yml label (minus a
 * trailing ellipsis) must equal the shortcut definitions' label for every
 * menu-backed id, or carry a recorded, reasoned exemption.
 *
 * Purpose: the palette, Settings shortcuts and toolbar tooltips all read the
 * definitions label, so a menu that says something else is "two names, one
 * command". This leg pairs each builder `with_id` site with its `t!` key,
 * reads the `menu:` block of en.yml, and reports every mismatch.
 *
 * @coordinates-with scripts/check-keybinding-manifest.mjs — the CLI that runs the legs
 * @coordinates-with scripts/lib/rustSource.mjs — comment/literal blanking for the builder scan
 * @module scripts/lib/keybindingManifest/labelParity
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { rustCode } from "../rustSource.mjs";
import { DEFS_PATH, LOCALIZED_DIR, ROOT, fail, readOrDie, unquote } from "./context.mjs";

// --- Label parity: ONE label per command -----------------------------------
//
// The native menu's en.yml label (minus a trailing ellipsis) must equal the
// shortcutDefinitions label for every menu-backed id: the palette, Settings
// shortcuts and toolbar tooltips all read the definitions label, so a menu
// that says something else is the "two names, one command" drift this gate
// exists to kill. Exemptions carry a reason, in the compressed-range style.
// A SUBMENU item inherits its parent's noun ("Insert → Image"), while the
// flat surfaces (palette, Settings, tooltips) must stand alone ("Insert
// Image"). Byte equality would force verbose menus or ambiguous flat labels,
// so the submenu-context class is exempt BY ID with the folding stated.
// Each exemption RECORDS BOTH labels it exempts (the menu side and the
// definitions side): an exemption that accepted any non-equal pair would let
// EITHER label drift to anything while staying green. A change on either side
// of an exempt id now fails until the recorded tuple is updated — the drift
// gets reviewed, not absorbed.
const LABEL_EXEMPT = new Map([
  ["image", { menu: "Image", defs: "Insert Image", reason: "Insert submenu supplies the verb — flat label folds it in (Insert Image)" }],
  ["video", { menu: "Video", defs: "Insert Video", reason: "Insert submenu supplies the verb (Insert Video)" }],
  ["audio", { menu: "Audio", defs: "Insert Audio", reason: "Insert submenu supplies the verb (Insert Audio)" }],
  ["diagram", { menu: "Diagram", defs: "Insert Diagram", reason: "Insert submenu supplies the verb (Insert Diagram)" }],
  ["graphviz-diagram", { menu: "Graphviz Diagram", defs: "Insert Graphviz Diagram", reason: "Insert submenu supplies the verb (Insert Graphviz Diagram)" }],
  ["mindmap", { menu: "Mindmap", defs: "Insert Mindmap", reason: "Insert submenu supplies the verb (Insert Mindmap)" }],
  ["info-note", { menu: "Note", defs: "Insert Note", reason: "Info Box submenu supplies the noun (Insert Note)" }],
  ["info-tip", { menu: "Tip", defs: "Insert Tip", reason: "Info Box submenu supplies the noun (Insert Tip)" }],
  ["info-warning", { menu: "Warning", defs: "Insert Warning", reason: "Info Box submenu supplies the noun (Insert Warning)" }],
  ["info-important", { menu: "Important", defs: "Insert Important", reason: "Info Box submenu supplies the noun (Insert Important)" }],
  ["info-caution", { menu: "Caution", defs: "Insert Caution", reason: "Info Box submenu supplies the noun (Insert Caution)" }],
  ["collapsible-block", { menu: "Collapsible Block", defs: "Insert Collapsible Block", reason: "Insert menu supplies the verb (Insert Collapsible Block)" }],
  ["export-html", { menu: "HTML", defs: "Export HTML", reason: "Export submenu supplies the verb (Export HTML)" }],
  ["export-pdf-native", { menu: "PDF", defs: "Export PDF", reason: "Export submenu supplies the verb (Export PDF)" }],
  ["transform-uppercase", { menu: "UPPERCASE", defs: "Transform to UPPERCASE", reason: "Transform submenu supplies the verb (Transform to UPPERCASE)" }],
  ["transform-lowercase", { menu: "lowercase", defs: "Transform to lowercase", reason: "Transform submenu supplies the verb (Transform to lowercase)" }],
  ["transform-title-case", { menu: "Title Case", defs: "Transform to Title Case", reason: "Transform submenu supplies the verb (Transform to Title Case)" }],
  ["format-cjk", { menu: "Format Selection", defs: "Format CJK Selection", reason: "CJK submenu supplies the noun — flat canonical is Format CJK Selection (WI-UI4.3)" }],
  ["format-cjk-file", { menu: "Format Entire File", defs: "Format CJK File", reason: "CJK submenu supplies the noun — flat canonical is Format CJK File (WI-UI4.3)" }],
  ["new", { menu: "New", defs: "New File", reason: "the File MENU column supplies the noun (New); the flat label stands alone (New File)" }],
  ["save-all-quit", { menu: "Save All and Exit", defs: "Save All and Quit", reason: "the non-macOS File-menu tail says Exit — that platform's word for Quit — while the macOS App-menu site says Quit and matches the flat label; a second live site the scan used to mask (audit 20260907 #45)" }],
]);

// Manifest ids with NO Rust label pair, each with a stated reason. Any other
// unpaired id fails — silent skips are how a builder rewrite would blind the
// whole leg while it kept reporting green. EMPTY today: every manifest id
// pairs (the one dynamic id, search-genies, is excluded from the manifest by
// DYNAMIC_MENU_IDS before this leg runs).
const UNPAIRED_OK = new Map([]);

function menuLabelPairs() {
  const pairs = new Map(); // menu id -> Set<en.yml key>, one per LIVE builder site
  for (const file of readdirSync(join(ROOT, LOCALIZED_DIR)).filter((f) => f.endsWith(".rs") && !f.endsWith(".test.rs"))) {
    const rel = `${LOCALIZED_DIR}/${file}`;
    // `with_id(app, "<id>", &t!("menu.<key>")` — id and label key co-occur in
    // one builder call. Scanned over CODE (comments blanked, literals kept), so
    // a commented-out site labels nothing; and EVERY live key is kept, so the
    // label leg checks each one. Keeping the first let a second site's label
    // (the non-macOS File-menu tail's "Save All and Exit") hide behind the
    // macOS App-menu site's for months.
    // TWO PASSES, the rule `headerReferences.pathMountedModulePaths` and
    // `dod-syntax.rustModIncludes` already apply to the same shape: the match
    // runs over code with LITERALS KEPT (the id and the key ARE literals), and
    // the fully-blanked copy then says whether the surrounding call is real
    // CODE. With one pass, builder-shaped text inside a raw string
    // (`r#""save", &t!("menu.save")"#`) labelled a menu item that no builder
    // ever calls. `&t!(` survives blanking only outside a
    // literal, so its offset is the discriminator.
    const source = readOrDie(rel);
    const code = rustCode(source, { keepStrings: true });
    const bare = rustCode(source);
    for (const m of code.matchAll(/"([a-z0-9-]+)",\s*&t!\("([A-Za-z0-9_.]+)"\)/g)) {
      const callAt = m.index + m[0].indexOf("&t!(");
      if (bare.slice(callAt, callAt + 4) !== "&t!(") continue;
      if (!pairs.has(m[1])) pairs.set(m[1], new Set());
      pairs.get(m[1]).add(m[2]);
    }
  }
  return pairs;
}

/**
 * `menu.<key>` → label, read from the `menu:` block of `src-tauri/locales/en.yml`.
 *
 * SECTION-SCOPED. The scan used to take every two-space-indented key in the
 * file and prefix it `menu.`, so the 100+ keys under `errors:`, `window:` and
 * `cli:` became phantom `menu.*` entries — and since `errors:` comes after
 * `menu:`, a key sharing a dotted tail would have OVERWRITTEN the real label.
 * Duplicates are refused rather than silently kept-last, and
 * the double-quoted scalar is UNQUOTED, so `\"` and `\\` compare as the text
 * the app renders rather than as their source spelling.
 *
 * A `menu:` value that is not a double-quoted scalar is left out on purpose:
 * the consumer reports `en.yml has no such key`, which is the loud outcome —
 * this gate refuses to guess how an unquoted or folded scalar renders.
 */
function enYmlLabels() {
  const raw = readOrDie("src-tauri/locales/en.yml");
  const labels = new Map();
  let inMenu = false;
  for (const line of raw.split("\n")) {
    if (/^[^\s#]/.test(line)) {
      inMenu = /^menu:\s*$/.test(line);
      continue;
    }
    if (!inMenu) continue;
    const m = /^\s{2}([A-Za-z0-9_.]+):\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(line);
    if (!m) continue;
    const key = `menu.${m[1]}`;
    if (labels.has(key)) fail(`src-tauri/locales/en.yml: duplicate key "${m[1]}" under menu: — one key, one label`);
    labels.set(key, unquote(m[2]));
  }
  return labels;
}

/** Run the label leg over the synced `manifest`, pushing every problem onto `errors`. */
export function checkLabelParity(manifest, errors) {
  const pairs = menuLabelPairs();
  const ymlLabels = enYmlLabels();
  for (const entry of manifest) {
    const keys = pairs.get(entry.menuId);
    if (!keys) {
      // No silent skips: every unpaired id is either in the reasoned
      // allowlist or a failure. A builder rewrite that breaks
      // menuLabelPairs()'s pattern now fails on the FIRST id, not never.
      if (!UNPAIRED_OK.has(entry.menuId)) {
        errors.push(
          `menu id "${entry.menuId}" has no label pair in the Rust builder — ` +
            `menuLabelPairs() missed it (pattern drift?), or add a reasoned UNPAIRED_OK entry.`,
        );
      }
      continue;
    }
    if (UNPAIRED_OK.has(entry.menuId)) {
      errors.push(`stale UNPAIRED_OK entry "${entry.menuId}": the id pairs now — remove the exemption.`);
    }
    // Every live site's label, canonicalised. A platform-conditional item
    // (the macOS App menu and the non-macOS File-menu tail) has two.
    const menuLabels = [];
    for (const key of keys) {
      const menuLabel = ymlLabels.get(key);
      if (menuLabel === undefined) errors.push(`menu id "${entry.menuId}" labels via t!("${key}") but en.yml has no such key`);
      else menuLabels.push({ key, label: menuLabel.replace(/…$/, "").trim() });
    }
    const exempt = LABEL_EXEMPT.get(entry.menuId);
    if (exempt) {
      // An exemption whose fold has quietly become byte-equal at EVERY site no
      // longer exempts anything — delete it rather than let it mask drift.
      if (menuLabels.every((m) => m.label === entry.label)) {
        errors.push(
          `stale LABEL_EXEMPT entry "${entry.menuId}": menu and definitions labels are now identical ` +
            `(${JSON.stringify(entry.label)}) — remove the exemption.`,
        );
        continue;
      }
      for (const m of menuLabels) {
        if (m.label !== entry.label && m.label !== exempt.menu) {
          errors.push(
            `LABEL_EXEMPT entry "${entry.menuId}" recorded menu label ${JSON.stringify(exempt.menu)} ` +
              `but the menu now says ${JSON.stringify(m.label)} (en.yml ${m.key}) — re-review the exemption and update its recorded label.`,
          );
        }
      }
      if (entry.label !== exempt.defs) {
        errors.push(
          `LABEL_EXEMPT entry "${entry.menuId}" recorded definitions label ${JSON.stringify(exempt.defs)} ` +
            `but ${DEFS_PATH} now says ${JSON.stringify(entry.label)} — re-review the exemption and update its recorded label.`,
        );
      }
      continue;
    }
    for (const m of menuLabels) {
      if (m.label !== entry.label) {
        errors.push(
          `label drift for "${entry.menuId}": menu says ${JSON.stringify(m.label)} (en.yml ${m.key}) ` +
            `but ${DEFS_PATH} says ${JSON.stringify(entry.label)} — one command, one label (WI-UI4.3)`,
        );
      }
    }
  }
  // Exemption liveness, the other direction: an exempt id that no longer
  // exists in the manifest is a rename the map silently outlived.
  const manifestIds = new Set(manifest.map((e) => e.menuId));
  for (const id of [...LABEL_EXEMPT.keys(), ...UNPAIRED_OK.keys()]) {
    if (!manifestIds.has(id)) {
      errors.push(`stale exemption "${id}": no such menu id in the manifest — remove it.`);
    }
  }
}
