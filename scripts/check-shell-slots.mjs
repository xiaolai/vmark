#!/usr/bin/env node
/**
 * Shell-slot budget gate — ADR-007.
 *
 * ADR-007 makes `src/shell/AppShell.tsx` the composition root and says:
 * "New top-level surfaces (panels, overlays) become slot registrations, not
 * edits to `App.tsx`." Nothing enforced that, so App.tsx accumulated direct
 * surface mounts until it sat at 296/300 lines — the exact pressure the slot
 * system exists to relieve — and a full-height docked panel (Knowledge Base)
 * ended up in the `overlays` slot as a `position: fixed` surface that occluded
 * the editor, with no gate to notice the inconsistency.
 *
 * This counts top-level surface mounts in App.tsx and pins the number in a
 * committed baseline that may only go DOWN. Adding another surface directly to
 * App.tsx fails; so does letting the baseline go stale after an improvement.
 * (Mirrors scripts/check-file-size.mjs and check-extension-budget.mjs.)
 *
 * The fix when it fires is not to raise the number — it is to bundle related
 * surfaces behind one mount, the way `components/CoherenceOverlays.tsx` already
 * does for the coherence layer ("so growing the semantic layer never grows
 * App.tsx"), or to give the surface a real slot on the shell.
 *
 * Usage: node scripts/check-shell-slots.mjs
 */
import { readFileSync } from "node:fs";

const APP_PATH = "src/App.tsx";
const BASELINE_PATH = "scripts/shell-slots-baseline.json";

/** JSX mounts of top-level surfaces, e.g. `<QuickLookOverlay />`. */
const SURFACE_RE = /^\s*<([A-Z][A-Za-z]*(?:Overlay|Panel|Dialog|Picker|Modal|Toast))[\s/>]/gm;

function read(path, label) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    console.error(`❌ Cannot read ${label} (${path}): ${error.message}`);
    process.exit(1);
  }
}

export function countSurfaceMounts(source) {
  return [...source.matchAll(SURFACE_RE)].map((m) => m[1]);
}

const source = read(APP_PATH, "App.tsx");
const baselineRaw = read(BASELINE_PATH, "shell-slots baseline");

let baseline;
try {
  baseline = JSON.parse(baselineRaw);
} catch (error) {
  console.error(`❌ ${BASELINE_PATH} is not valid JSON: ${error.message}`);
  process.exit(1);
}

const limit = baseline.maxDirectSurfaceMounts;
if (!Number.isInteger(limit)) {
  console.error(`❌ ${BASELINE_PATH} needs an integer \`maxDirectSurfaceMounts\`.`);
  process.exit(1);
}

const found = countSurfaceMounts(source);
const actual = found.length;

if (actual > limit) {
  console.error(
    `\n❌ ADR-007: ${actual} top-level surfaces are mounted directly in ${APP_PATH}, budget is ${limit}.\n` +
      `   ${found.join(", ")}\n\n` +
      `   Do NOT raise the budget. Bundle related surfaces behind a single mount\n` +
      `   (see src/components/CoherenceOverlays.tsx) or register the surface as a\n` +
      `   shell slot. A full-height docked panel belongs in EditorArea's\n` +
      `   \`sidePanel\` slot, not in \`overlays\` — an overlay occludes the editor.\n`
  );
  process.exit(1);
}

if (actual < limit) {
  console.error(
    `\n❌ Budget is stale: only ${actual} direct surface mounts remain but the budget says ${limit}.\n` +
      `   Lower \`maxDirectSurfaceMounts\` to ${actual} in ${BASELINE_PATH} to lock the win in.\n`
  );
  process.exit(1);
}

console.log(`✅ Shell-slot budget held (${actual}/${limit} direct surface mounts in App.tsx).`);
