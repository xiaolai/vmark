/**
 * WI-UI0.1 — the `contrastFloors` PAIR comparator for
 * scripts/theme-contrast-baseline.json's `ansiFloor` / `exempt` sections.
 *
 * A pair comparator, not a set comparator: the Set-based custom API cannot
 * compare paired numeric values, and encoding "the floor may only rise" as
 * identity strings would make every legitimate raise read as a removal. The
 * Codex review of the UI-consistency plan (objection #14) demonstrated the
 * set API silently passing a 2.4 → 1.1 floor cut; this module exists so that
 * cut fails.
 *
 * Semantics:
 *   - lowering an `ansiFloor` value is LOOSENING → failure
 *   - raising it is tightening → notice
 *   - a new floor or exempt entry follows the check's `onAdd`
 *   - removing either is tightening (the 4.5 default resumes) → notice
 *   - a blank `reason` on either section → failure (the gate itself also
 *     refuses it at runtime; this catches the edit at PR time from history
 *     the PR cannot rewrite)
 *
 * @coordinates-with scripts/baselineRatchetModes.mjs — registers this under
 *   CUSTOM_PAIR_COMPARATORS
 * @coordinates-with scripts/check-theme-contrast.ts — the gate that consumes
 *   the floors at runtime
 */

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function reasonMissing(entry) {
  return typeof entry?.reason !== "string" || entry.reason.trim() === "";
}

/** Pair comparator: (baseDoc, headDoc, check, filePath) → {failures, notices, raises}. */
export function contrastFloors(baseDoc, headDoc, check, filePath) {
  const failures = [];
  const notices = [];
  const added = [];

  const baseFloors = isPlainObject(baseDoc?.ansiFloor) ? baseDoc.ansiFloor : {};
  const headFloors = isPlainObject(headDoc?.ansiFloor) ? headDoc.ansiFloor : {};

  for (const [theme, entry] of Object.entries(headFloors)) {
    if (reasonMissing(entry)) {
      failures.push(`${filePath}: ansiFloor.${theme} has no reason — state why, or delete it.`);
    }
    if (typeof entry?.value !== "number" || !Number.isFinite(entry.value)) {
      failures.push(`${filePath}: ansiFloor.${theme} has no numeric value.`);
      continue;
    }
    const before = baseFloors[theme];
    if (before === undefined) {
      added.push(`ansiFloor.${theme} @ ${entry.value}`);
    } else if (typeof before.value === "number" && entry.value < before.value) {
      failures.push(
        `${filePath}: ansiFloor.${theme} lowered ${before.value} → ${entry.value} — a floor may only rise ` +
          "(lowering it admits new contrast failures under the theme's exception).",
      );
    } else if (typeof before.value === "number" && entry.value > before.value) {
      notices.push(`${filePath}: ansiFloor.${theme} raised ${before.value} → ${entry.value} (tightening)`);
    }
  }
  for (const theme of Object.keys(baseFloors)) {
    if (!(theme in headFloors)) {
      notices.push(`${filePath}: ansiFloor.${theme} removed — the 4.5 default resumes (tightening)`);
    }
  }

  const baseExempt = isPlainObject(baseDoc?.exempt) ? baseDoc.exempt : {};
  const headExempt = isPlainObject(headDoc?.exempt) ? headDoc.exempt : {};
  const idsOf = (section) => {
    const out = new Set();
    for (const [theme, entries] of Object.entries(section)) {
      if (!Array.isArray(entries)) continue;
      for (const e of entries) out.add(`${theme}/${e?.id}`);
    }
    return out;
  };
  for (const [theme, entries] of Object.entries(headExempt)) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      if (reasonMissing(e)) failures.push(`${filePath}: exempt ${theme}/${e?.id} has no reason.`);
    }
  }
  const baseIds = idsOf(baseExempt);
  for (const id of idsOf(headExempt)) {
    if (!baseIds.has(id)) added.push(`exempt ${id}`);
  }

  if (added.length > 0) {
    if (check.onAdd === "fail") {
      failures.push(`${filePath}: ${added.length} new floor/exempt entr${added.length > 1 ? "ies" : "y"}:`);
      for (const a of added) failures.push(`    + ${a}`);
    } else {
      notices.push(`${filePath}: ${added.length} new floor/exempt entr${added.length > 1 ? "ies" : "y"}`);
      for (const a of added) notices.push(`    + ${a}`);
    }
  }
  return { failures, notices, raises: [] };
}
