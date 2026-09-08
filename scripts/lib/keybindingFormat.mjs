/**
 * ProseMirror key → docs notation (`Alt-Mod-v` → `Alt + Mod + V`), shared by
 * the keybinding gate and the doc joins.
 *
 * Extracted from scripts/check-keybinding-manifest.mjs, which is a linear
 * program: importing it READS five sources, runs every check, prints the gate's
 * success line and `process.exit(1)`s on red. The lint-table doc join needs the
 * same renderer — the documented trigger must be the `validateMarkdown` default
 * written the way `website/guide/shortcuts.md` writes chords — and importing it
 * from the gate would have run a second gate inside the first: a keybinding
 * failure would then surface twice (once per gate, one defect), and a vitest
 * worker loading the join would die on the gate's `process.exit`. A renderer
 * with one definition and no side effects is the fix; the gate imports it
 * from here so the two cannot drift.
 *
 * @coordinates-with scripts/check-keybinding-manifest.mjs — original home; imports from here
 * @coordinates-with scripts/lib/docJoins/lintTable.mjs — renders the documented lint trigger
 * @coordinates-with src/stores/settingsStore/keyFormatting.ts — the APP's converter; `prosemirrorToTauri` here must agree with it, and the self-test proves it
 * @coordinates-with scripts/lib/keybindingFormat.test.mjs — the self-test
 */

/**
 * ProseMirror key (`Mod-Shift-n`) → raw token list, handling the trailing `-`
 * (minus) key. An empty part is legal in exactly one shape: the trailing `-`
 * that means the MINUS key (`Mod--` → ["Mod", "-"]), which splits into two
 * empties — the separator's and the key's. Anywhere else (`-Mod-A`,
 * `Mod--Shift-A`) it is a malformed key, and normalising it would document a
 * chord the app never binds — so it throws instead.
 *
 * The PAIR is what makes the minus key, not the trailing empty alone: any
 * final empty used to become `-`, so `Mod-` (a dangling separator, no key)
 * rendered as `Mod + -` — indistinguishable from the real `Mod--` — and
 * `keyTokens("")` returned `["-"]`, a chord out of nothing (audit R2 #186).
 */
export function keyTokens(key) {
  const parts = key.split("-");
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p !== "") out.push(p);
    // The last empty is the minus KEY only when the one before it is the
    // separator's own empty (`--`, or the bare `-` whose parts are ["", ""]).
    else if (i === parts.length - 1 && i > 0 && parts[i - 1] === "") out.push("-");
    else if (!(i === parts.length - 2 && parts[i + 1] === "")) {
      throw new Error(`malformed shortcut key ${JSON.stringify(key)}: empty token at position ${i}`);
    }
  }
  return out;
}

/**
 * Human-readable docs accelerator for a ProseMirror key (`Mod-Shift-n` →
 * `Mod + Shift + N`): `-` → ` + `, `Mod` kept verbatim, single LETTERS
 * upper-cased — any script's letter (`\p{L}`), not only ASCII, so `é` renders
 * as `É` the way `n` renders as `N`. "Single" is one CODE POINT, not one
 * UTF-16 unit: an astral letter (Deseret `𐐨`) is two units long and a
 * `length === 1` test left it lower-case (audit 20260907 #91).
 * The keybinding gate uses it for error messages (its matching goes through
 * `canonAccel` for order tolerance); the lint-table doc join uses it as the
 * canonical spelling a guide page must carry.
 */
export function prosemirrorToDocs(key) {
  if (!key) return "";
  return keyTokens(key)
    .map((t) => (/^\p{L}$/u.test(t) ? t.toUpperCase() : t))
    .join(" + ");
}

/**
 * ProseMirror key → Tauri accelerator (`Mod-b` → `CmdOrCtrl+B`), the conversion
 * the keybinding gate compares the Rust menu against.
 *
 * A PORT of `src/stores/settingsStore/keyFormatting.ts`'s `prosemirrorToTauri`,
 * because the gate runs under plain `node` with no TypeScript runtime and the
 * app's copy pulls in `@/utils/shortcutMatch`. The port used to sit inside the
 * gate under a "keep in sync if that converter changes" comment — a rule with
 * no enforcement, on the one value the whole gate compares by (audit R3 #57).
 * `keybindingFormat.test.mjs` now runs both implementations over every key in
 * `shortcutDefinitions.ts` plus the edge shapes, so a divergence fails a test
 * instead of silently redefining what "aligned" means.
 */
export function prosemirrorToTauri(key) {
  if (!key) return "";
  const modifierNames = new Set(["Mod", "Ctrl", "Alt", "Shift"]);
  const modifierMap = { Mod: "CmdOrCtrl" };
  const parts = key.split("-");
  const result = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "" && i === parts.length - 1) {
      result.push("-");
    } else if (part === "") {
      continue;
    } else if (modifierNames.has(part) && i < parts.length - 1) {
      result.push(modifierMap[part] ?? part);
    } else {
      const mapped = modifierMap[part] ?? part;
      if (mapped.length === 1 && /[a-z]/i.test(mapped)) {
        result.push(mapped.toUpperCase());
      } else {
        result.push(mapped);
      }
    }
  }
  return result.join("+");
}
