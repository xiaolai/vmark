// Spike D — characterize `yaml` (eemeli) Document API round-trip behavior.
//
// For every fixture, we run two scenarios:
//
//   1. Identity round-trip: parseDocument(orig) → toString → diff vs orig.
//      Tells us what `toString()` normalizes by default.
//
//   2. Targeted edits: apply 3 representative IR-level mutations and verify:
//      - comments preserved
//      - anchors/aliases preserved
//      - byte-diff is contained near the targeted region
//      - parseDocument(saved).toJS() == parseDocument(orig+edit).toJS()
//
// Output: characterization table + concrete gate definition for ADR-11.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";

const FIXTURE_DIR = "../fixtures";

// ─── Helpers ──────────────────────────────────────────────────────────────

function lineDiff(a, b) {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const max = Math.max(aLines.length, bLines.length);
  const changed = [];
  for (let i = 0; i < max; i++) {
    if (aLines[i] !== bLines[i]) {
      changed.push({ line: i + 1, before: aLines[i], after: bLines[i] });
    }
  }
  return changed;
}

function summarizeDiff(diff) {
  if (diff.length === 0) return "byte-identical";
  const samples = diff.slice(0, 3).map((d) => `L${d.line}: ${JSON.stringify(d.before ?? "")} → ${JSON.stringify(d.after ?? "")}`);
  return `${diff.length} line${diff.length === 1 ? "" : "s"} changed${samples.length ? "\n      " + samples.join("\n      ") : ""}`;
}

function commentCount(yamlString) {
  return yamlString.split("\n").filter((l) => l.trim().startsWith("#")).length;
}

function anchorCount(yamlString) {
  return (yamlString.match(/&[A-Za-z0-9_-]+/g) ?? []).length;
}

// ─── Probe ────────────────────────────────────────────────────────────────

function probe(fixtureName, content) {
  const result = {
    fixture: fixtureName,
    sizeBytes: content.length,
    commentsBefore: commentCount(content),
    anchorsBefore: anchorCount(content),
    identity: { ok: false, diffLines: 0, sample: "" },
    edits: [],
  };

  // 1. Identity round-trip — with toString options that minimize normalization.
  // lineWidth: 0 disables auto-wrapping of long strings (the biggest source of
  // cosmetic diff). flowCollectionPadding controls `[ a ]` vs `[a]` spacing.
  const stringifyOpts = { lineWidth: 0, flowCollectionPadding: false };
  const doc = parseDocument(content);
  const back = doc.toString(stringifyOpts);
  const idDiff = lineDiff(content, back);
  result.identity = {
    ok: idDiff.length === 0,
    diffLines: idDiff.length,
    sample: summarizeDiff(idDiff),
    commentsAfter: commentCount(back),
    anchorsAfter: anchorCount(back),
    sizeAfter: back.length,
  };

  // 2. Targeted edits — pick 3 representative IR mutations
  const editScenarios = [
    {
      name: "rename a top-level key",
      mutate: (d) => {
        const name = d.get("name");
        if (name !== undefined) d.set("name", `${name} [edited]`);
        else d.set("name", "spike-d-edit");
      },
    },
    {
      name: "add an env var to workflow level",
      mutate: (d) => {
        let env = d.get("env");
        if (!env) {
          d.set("env", { SPIKE_D: "yes" });
        } else if (env.set) {
          env.set("SPIKE_D", "yes");
        }
      },
    },
    {
      name: "modify first job's first step name",
      mutate: (d) => {
        const jobs = d.get("jobs");
        if (!jobs) return;
        const firstJobKey = jobs.items[0]?.key?.value;
        if (!firstJobKey) return;
        const job = jobs.get(firstJobKey);
        const steps = job?.get?.("steps");
        if (!steps || !steps.items?.[0]) return;
        const firstStep = steps.items[0];
        if (firstStep.set) firstStep.set("name", "spike-d-edited");
      },
    },
  ];

  for (const scenario of editScenarios) {
    const edited = parseDocument(content);
    try {
      scenario.mutate(edited);
    } catch (e) {
      result.edits.push({ name: scenario.name, error: e.message });
      continue;
    }
    const editedStr = edited.toString(stringifyOpts);
    const diff = lineDiff(content, editedStr);

    const reparsed = parseDocument(editedStr);

    result.edits.push({
      name: scenario.name,
      diffLines: diff.length,
      sample: summarizeDiff(diff.slice(0, 5)),
      commentsAfter: commentCount(editedStr),
      anchorsAfter: anchorCount(editedStr),
      reparsedOk: reparsed.errors.length === 0,
      // Test minimal-diff property: how concentrated is the change?
      changedSpan:
        diff.length === 0
          ? 0
          : diff[diff.length - 1].line - diff[0].line + 1,
    });
  }

  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────

const fixtures = readdirSync(FIXTURE_DIR).filter(
  (f) => f.endsWith(".yml") || f.endsWith(".yaml"),
);

console.log("\n# Spike D — `yaml` (eemeli) round-trip characterization\n");

let agg = {
  total: 0,
  identicalCount: 0,
  commentsLost: 0,
  anchorsLost: 0,
};

for (const f of fixtures) {
  const content = readFileSync(join(FIXTURE_DIR, f), "utf8");
  const r = probe(f, content);
  agg.total++;
  if (r.identity.ok) agg.identicalCount++;
  if (r.identity.commentsAfter < r.commentsBefore) agg.commentsLost++;
  if (r.identity.anchorsAfter < r.anchorsBefore) agg.anchorsLost++;

  console.log(`\n## ${f} (${r.sizeBytes} bytes, ${r.commentsBefore} comments, ${r.anchorsBefore} anchors)\n`);
  console.log(`### Identity round-trip\n`);
  console.log(
    `- byte-identical: **${r.identity.ok ? "yes" : "no"}**, diffLines=${r.identity.diffLines}`,
  );
  console.log(
    `- comments: before=${r.commentsBefore} after=${r.identity.commentsAfter} ` +
      (r.identity.commentsAfter === r.commentsBefore ? "✓" : "✗ LOST"),
  );
  console.log(
    `- anchors: before=${r.anchorsBefore} after=${r.identity.anchorsAfter} ` +
      (r.identity.anchorsAfter === r.anchorsBefore ? "✓" : "✗ LOST"),
  );
  if (!r.identity.ok) console.log(`- sample diff: ${r.identity.sample}`);

  console.log(`\n### Targeted edits\n`);
  for (const e of r.edits) {
    console.log(`- **${e.name}**`);
    if (e.error) {
      console.log(`  - ERROR: ${e.error}`);
      continue;
    }
    console.log(
      `  - diffLines=${e.diffLines}, changedSpan=${e.changedSpan} lines, ` +
        `comments=${e.commentsAfter}/${r.commentsBefore} ` +
        (e.commentsAfter === r.commentsBefore ? "✓" : "✗"),
    );
    console.log(`  - reparsed without errors: ${e.reparsedOk ? "✓" : "✗"}`);
    if (e.diffLines > 0 && e.diffLines <= 3) console.log(`  - ${e.sample}`);
  }
}

console.log(`\n## Aggregate\n`);
console.log(`- Fixtures: ${agg.total}`);
console.log(`- Byte-identical identity round-trips: ${agg.identicalCount}/${agg.total}`);
console.log(`- Fixtures losing comments on identity round-trip: ${agg.commentsLost}/${agg.total}`);
console.log(`- Fixtures losing anchors on identity round-trip: ${agg.anchorsLost}/${agg.total}`);
