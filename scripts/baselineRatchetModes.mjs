/**
 * The comparison engine behind the baseline ratchet: one function per
 * comparison mode, plus the allowRaise reconciliation.
 *
 * Every function here is pure — base value in, head value in, failures and
 * notices out — so the CLI (scripts/check-baseline-ratchet.mjs) owns all of
 * the git, filesystem and process-exit behaviour and this file owns none of
 * it. Failures are strings naming file + key, because a gate that says only
 * "something loosened" cannot be acted on.
 *
 * Anything unreadable THROWS rather than comparing as empty: a baseline whose
 * shape the engine does not understand must fail closed, since "no entries
 * found" and "no violations" are indistinguishable at the exit code.
 *
 * @coordinates-with scripts/baselineRatchetManifest.mjs — the entries this applies to
 * @coordinates-with scripts/check-baseline-ratchet.mjs — the sole caller
 * @coordinates-with scripts/baselineRatchetTsAllowlist.mjs — the one custom
 *   comparator, kept in its own module because reading identities out of
 *   TypeScript source is a parser, not a comparison mode
 */
import { tsIdenticalAllowlistIdentities } from "./baselineRatchetTsAllowlist.mjs";
import { contrastFloors } from "./baselineRatchetContrastFloors.mjs";
import {
  specConformanceRecords,
  specRoundtripRecords,
  specCorpusExamples,
  tsExpectedDeltas,
  tsFidelityLedger,
} from "./baselineRatchetSpecLedgers.mjs";

/** `//`-prefixed and `_`-prefixed keys are prose, present in most baselines. */
function isCommentKey(key) {
  return key.startsWith("//") || key.startsWith("_");
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Read a dotted path. `""` is the value itself. */
function getAt(value, at) {
  if (at === "") return value;
  let cur = value;
  for (const seg of at.split(".")) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * Flatten a (possibly nested) map of counts to dotted keys. Throws on a leaf
 * that is neither a number nor a nested map — an unreadable baseline must
 * fail, never compare as empty.
 */
function flattenCounts(value, label, prefix = "", out = new Map()) {
  if (!isPlainObject(value)) throw new Error(`${label}: expected an object of counts`);
  for (const [k, v] of Object.entries(value)) {
    if (isCommentKey(k)) continue;
    const key = prefix + k;
    if (typeof v === "number" && Number.isFinite(v)) out.set(key, v);
    else if (isPlainObject(v)) flattenCounts(v, label, `${key}.`, out);
    else throw new Error(`${label}: ${key} is neither a count nor a nested map`);
  }
  return out;
}

/** Identity set for one of the three identity shapes. */
function identitySet(value, { shape, key }, label) {
  const out = new Set();
  if (shape === "object-keys") {
    if (!isPlainObject(value)) throw new Error(`${label}: expected an object`);
    for (const k of Object.keys(value)) if (!isCommentKey(k)) out.add(k);
    return out;
  }
  if (!Array.isArray(value)) throw new Error(`${label}: expected an array`);
  for (const item of value) {
    if (shape === "strings") {
      if (typeof item !== "string") throw new Error(`${label}: expected an array of strings`);
      out.add(item);
    } else if (shape === "objects") {
      if (!Array.isArray(key) || key.length === 0) {
        throw new Error(`${label}: identity shape "objects" needs a non-empty \`key\``);
      }
      const parts = key.map((field) => {
        const v = getAt(item, field);
        if (typeof v !== "string") throw new Error(`${label}: entry is missing string field "${field}"`);
        return v;
      });
      out.add(parts.join(" | "));
    } else {
      throw new Error(`${label}: unknown identity shape "${shape}"`);
    }
  }
  return out;
}

const CUSTOM_COMPARATORS = {
  tsIdenticalAllowlist: tsIdenticalAllowlistIdentities,
  specConformanceRecords,
  specRoundtripRecords,
  specCorpusExamples,
  tsExpectedDeltas,
  tsFidelityLedger,
};

/**
 * PAIR comparators see both documents at once, for baselines whose loosening
 * is a numeric relation the Set API cannot express (a floor that may only
 * rise). Signature: (baseDoc, headDoc, check, filePath) → {failures, notices,
 * raises}.
 */
const CUSTOM_PAIR_COMPARATORS = {
  contrastFloors,
};

/**
 * Compare one check across base and head. Returns failures, allowed-addition
 * notices, and the raises observed (so allowRaise can consume them).
 */
export function evaluateCheck(check, baseDoc, headDoc, filePath) {
  const failures = [];
  const notices = [];
  const raises = [];
  const where = check.at === undefined ? filePath : `${filePath}:${check.at || "<root>"}`;

  if (check.mode === "custom") {
    const pairComparator = CUSTOM_PAIR_COMPARATORS[check.comparator];
    if (pairComparator) return pairComparator(baseDoc, headDoc, check, filePath);
    const comparator = CUSTOM_COMPARATORS[check.comparator];
    if (!comparator) {
      failures.push(`${filePath}: unknown custom comparator "${check.comparator}"`);
      return { failures, notices, raises };
    }
    const baseSet = comparator(baseDoc, `${where}@base`);
    const headSet = comparator(headDoc, where);
    return diffIdentity(baseSet, headSet, check, where);
  }

  const headValue = getAt(headDoc, check.at);
  if (headValue === undefined) {
    failures.push(
      `${filePath}: the manifest checks "${check.at || "<root>"}", which this file no longer has — ` +
        "update the manifest in the same change.",
    );
    return { failures, notices, raises };
  }
  const baseValue = getAt(baseDoc, check.at);
  if (baseValue === undefined) {
    notices.push(`shape change: ${where} did not exist at the merge base — nothing to ratchet against`);
    return { failures, notices, raises };
  }

  if (check.mode === "scalar") {
    if (typeof headValue !== "number" || typeof baseValue !== "number") {
      failures.push(`${where}: expected a number on both sides`);
      return { failures, notices, raises };
    }
    if (headValue > baseValue) raises.push({ path: filePath, key: check.at, from: baseValue, to: headValue });
    return { failures, notices, raises };
  }

  if (check.mode === "per-key-count") {
    const baseCounts = flattenCounts(baseValue, `${where}@base`);
    const headCounts = flattenCounts(headValue, where);
    const added = [];
    for (const [key, count] of headCounts) {
      const prefix = check.at ? `${check.at}.` : "";
      const before = baseCounts.get(key);
      if (before === undefined) added.push(`${prefix}${key} @ ${count}`);
      else if (count > before) {
        raises.push({ path: filePath, key: `${prefix}${key}`, from: before, to: count });
      }
    }
    if (added.length > 0) {
      notices.push(`${filePath}: ${added.length} new baselined entr${added.length > 1 ? "ies" : "y"}`);
      for (const a of added) notices.push(`    ${a}`);
    }
    return { failures, notices, raises };
  }

  if (check.mode === "identity") {
    const baseSet = identitySet(baseValue, check, `${where}@base`);
    const headSet = identitySet(headValue, check, where);
    return diffIdentity(baseSet, headSet, check, where);
  }

  failures.push(`${filePath}: unknown comparison mode "${check.mode}" in the manifest`);
  return { failures, notices, raises };
}

function diffIdentity(baseSet, headSet, check, where) {
  const failures = [];
  const notices = [];

  // `direction: "no-remove"` inverts the ratchet's polarity for corpus-like
  // sets: coverage only grows, so entries REMOVED (or mutated, when the
  // identity is content-addressed) since the merge base fail. Additions are
  // still governed by onAdd below.
  if (check.direction === "no-remove") {
    const removed = [...baseSet].filter((e) => !headSet.has(e));
    if (removed.length > 0) {
      failures.push(
        `${where}: ${removed.length} entr${removed.length > 1 ? "ies" : "y"} removed or changed since ` +
          "the merge base (this set only grows — coverage is never silently dropped or edited):",
      );
      for (const r of removed) failures.push(`    - ${r}`);
    }
  }

  const added = [...headSet].filter((e) => !baseSet.has(e));
  if (added.length === 0) return { failures, notices, raises: [] };

  if (check.onAdd === "fail") {
    failures.push(
      `${where}: ${added.length} entr${added.length > 1 ? "ies" : "y"} added since the merge base ` +
        "(this list only ratchets down — entries are removed, never added):",
    );
    for (const a of added) failures.push(`    + ${a}`);
  } else {
    notices.push(`${where}: ${added.length} new entr${added.length > 1 ? "ies" : "y"}`);
    for (const a of added) notices.push(`    + ${a}`);
  }
  return { failures, notices, raises: [] };
}

/**
 * Reconcile observed raises against the manifest's allowRaise entries.
 * A declared raise that did not happen is STALE — that is what makes the
 * exemption one-shot rather than permanent.
 */
export function reconcileAllowRaise(allowRaise, raises) {
  const failures = [];
  const notices = [];
  const consumed = new Set();

  for (const entry of allowRaise) {
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
      failures.push(`allowRaise for ${entry.path}:${entry.key} has no reason — state why, or delete it.`);
      continue;
    }
    const idx = raises.findIndex((r) => r.path === entry.path && r.key === entry.key && !consumed.has(r));
    const match = idx === -1 ? undefined : raises[idx];
    if (!match) {
      failures.push(
        `stale allowRaise: ${entry.path}:${entry.key} declares ${entry.from} → ${entry.to}, but no such ` +
          "raise exists against this merge base (it has already landed, or the value changed). Delete it.",
      );
      continue;
    }
    if (match.from !== entry.from || match.to !== entry.to) {
      failures.push(
        `allowRaise mismatch: ${entry.path}:${entry.key} permits ${entry.from} → ${entry.to}, ` +
          `but the actual change is ${match.from} → ${match.to}.`,
      );
      continue;
    }
    consumed.add(match);
    notices.push(`allowed raise: ${entry.path}:${entry.key} ${entry.from} → ${entry.to}`);
    notices.push(`    reason: ${entry.reason}`);
  }

  const unexplained = raises.filter((r) => !consumed.has(r));
  return { failures, notices, unexplained };
}
