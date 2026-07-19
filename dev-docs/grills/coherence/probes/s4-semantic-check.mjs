#!/usr/bin/env node
// Spike S4 (WI-0.7) — semantic-check precision on seeded contradictions,
// coherence-layer plan. Produces the M3 baseline (spec §11).
//
// Method: for each of the 24 cases in s4-corpus/cases.json, one
// `claude -p` call following spec §5.4.4 semantics: OLD upstream
// revision, NEW upstream revision, the changed region, and the
// downstream scene; demand one line of strict JSON
// {"verdict": contradiction|no-contradiction|unknown, "evidence", "confidence"}.
// Calls run SEQUENTIALLY. Malformed output is recorded as verdict
// "unknown" per R25 (never guessed) and flagged malformed_output.
// Results (incl. raw per-case model outputs): probes/s4-results.json.
// Zero npm deps.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const s3Dir = path.join(here, "s3-corpus");
const casesFile = path.join(here, "s4-corpus", "cases.json");
const outFile = path.join(here, "s4-results.json");

const { cases } = JSON.parse(fs.readFileSync(casesFile, "utf8"));
const read = (f) => fs.readFileSync(path.join(s3Dir, f), "utf8").trim();

// ── seeded-edit application (fails loudly on fixture drift) ─────────────
function applyEdit(oldText, edit, id) {
  if (edit.op === "append") return oldText.trimEnd() + "\n" + edit.new + "\n";
  if (edit.op === "replace") {
    if (!oldText.includes(edit.old))
      throw new Error(`${id}: edit.old substring not found in upstream doc`);
    if (oldText.split(edit.old).length !== 2)
      throw new Error(`${id}: edit.old substring is not unique in upstream doc`);
    return oldText.replace(edit.old, edit.new);
  }
  throw new Error(`${id}: unknown edit op ${edit.op}`);
}

// ── claude CLI call (cwd = tmpdir: don't load this repo's config) ───────
function callClaude(prompt) {
  const started = Date.now();
  const r = spawnSync("claude", ["-p", prompt, "--output-format", "json"], {
    encoding: "utf8",
    timeout: 300_000,
    cwd: os.tmpdir(),
    maxBuffer: 64 * 1024 * 1024,
  });
  const wall_ms = Date.now() - started;
  if (r.error) return { error: String(r.error), wall_ms };
  if (r.status !== 0)
    return { error: `exit ${r.status}: ${(r.stderr || "").slice(0, 500)}`, wall_ms };
  try {
    const events = JSON.parse(r.stdout);
    const arr = Array.isArray(events) ? events : [events];
    const res = arr.find((x) => x && x.type === "result");
    const init = arr.find((x) => x && x.type === "system" && x.subtype === "init");
    if (!res) return { error: "no result event in CLI output", wall_ms };
    if (res.is_error)
      return { error: `CLI result error: ${String(res.result).slice(0, 500)}`, wall_ms };
    return {
      text: String(res.result),
      model: init?.model ?? null,
      duration_ms: res.duration_ms ?? null,
      cost_usd: res.total_cost_usd ?? null,
      wall_ms,
    };
  } catch (e) {
    return { error: `CLI output parse: ${e.message}`, wall_ms };
  }
}

// ── robust one-line-JSON extraction ─────────────────────────────────────
function extractJsonObject(text) {
  const stripped = text.replace(/```(?:json)?/g, "").trim();
  const start = stripped.indexOf("{");
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < stripped.length; i++) {
    const c = stripped[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(stripped.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

const VERDICTS = ["contradiction", "no-contradiction", "unknown"];
function normalizeAnswer(obj) {
  if (!obj || typeof obj !== "object") return null;
  const v = typeof obj.verdict === "string" ? obj.verdict.trim().toLowerCase() : null;
  if (!VERDICTS.includes(v)) return null;
  let confidence = null;
  if (typeof obj.confidence === "number" && obj.confidence >= 0 && obj.confidence <= 1)
    confidence = obj.confidence;
  return {
    verdict: v,
    evidence: typeof obj.evidence === "string" ? obj.evidence : null,
    confidence,
  };
}

// ── prompt (spec §5.4.4 semantics) ──────────────────────────────────────
function buildPrompt(c, oldText, newText) {
  const changed =
    c.edit.op === "append"
      ? `(addition)\n+ ${c.edit.new}`
      : `- ${c.edit.old}\n+ ${c.edit.new}`;
  return `You are a semantic-consistency checker for a fiction workspace.

An upstream canon document was edited. The downstream scene below was written against the OLD revision. Judge whether the NEW revision CONTRADICTS the scene as written — that is, whether any fact the scene relies on is no longer true under the NEW revision.

- "contradiction": the scene, as written, is inconsistent with the NEW revision.
- "no-contradiction": the edit does not make the scene inconsistent (rewording with the same meaning, added detail the scene never touches, or changes to facts the scene does not rely on).
- "unknown": you cannot decide with reasonable confidence.

[UPSTREAM DOCUMENT ${c.upstream} — OLD revision (the scene was written against this)]
${oldText}

[UPSTREAM DOCUMENT ${c.upstream} — NEW revision (current)]
${newText}

[CHANGED REGION (old -> new)]
${changed}

[DOWNSTREAM SCENE ${c.scene}]
${read(c.scene)}

Answer with exactly one line of strict JSON and nothing else — no code fences, no commentary:
{"verdict": "contradiction" | "no-contradiction" | "unknown", "evidence": "<short quote from the scene or the NEW revision that decides it>", "confidence": <number between 0 and 1>}`;
}

// ── run ─────────────────────────────────────────────────────────────────
const results = [];
for (const c of cases) {
  const oldText = read(c.upstream);
  const newText = applyEdit(oldText, c.edit, c.id); // throws on fixture drift
  process.stderr.write(`[s4] ${c.id} (${c.ground_truth}) ... `);
  const call = callClaude(buildPrompt(c, oldText, newText));
  const parsed = call.text ? normalizeAnswer(extractJsonObject(call.text)) : null;
  const record = {
    id: c.id,
    upstream: c.upstream,
    scene: c.scene,
    seeded_edit: c.seeded_edit,
    ground_truth: c.ground_truth,
    rationale: c.rationale,
    model_raw: call.text ?? null,
    call_error: call.error ?? null,
    model: call.model ?? null,
    duration_ms: call.duration_ms ?? null,
    cost_usd: call.cost_usd ?? null,
    malformed_output: !parsed,
    // R25: malformed output is recorded as unknown, never guessed.
    verdict: parsed ? parsed.verdict : "unknown",
    evidence: parsed ? parsed.evidence : null,
    confidence: parsed ? parsed.confidence : null,
  };
  if (c.ground_truth === "ambiguous") {
    record.correct = null; // no single right answer by construction
  } else {
    record.correct = record.verdict === c.ground_truth;
  }
  results.push(record);
  process.stderr.write(
    parsed ? `${record.verdict} (conf ${record.confidence})\n` : "MALFORMED -> unknown\n",
  );
}

// ── metrics ─────────────────────────────────────────────────────────────
const seeded = results.filter((r) => r.ground_truth === "contradiction");
const clean = results.filter((r) => r.ground_truth === "no-contradiction");
const ambiguous = results.filter((r) => r.ground_truth === "ambiguous");

const tp = seeded.filter((r) => r.verdict === "contradiction").length;
const fnMiss = seeded.filter((r) => r.verdict === "no-contradiction").length;
const fnUnknown = seeded.filter((r) => r.verdict === "unknown").length;
const fp = clean.filter((r) => r.verdict === "contradiction").length;
const fpAmbiguous = ambiguous.filter((r) => r.verdict === "contradiction").length;

const precision = tp + fp ? +(tp / (tp + fp)).toFixed(4) : null;
const precisionStrict =
  tp + fp + fpAmbiguous ? +(tp / (tp + fp + fpAmbiguous)).toFixed(4) : null;
const recall = seeded.length ? +(tp / seeded.length).toFixed(4) : null;

const meanConf = (rs) => {
  const cs = rs.map((r) => r.confidence).filter((x) => typeof x === "number");
  return cs.length ? +(cs.reduce((a, b) => a + b, 0) / cs.length).toFixed(3) : null;
};

const summary = {
  spike: "S4",
  date: new Date().toISOString(),
  model: results.find((r) => r.model)?.model ?? null,
  cases_total: results.length,
  seeded_contradictions: seeded.length,
  seeded_no_contradiction: clean.length,
  seeded_ambiguous: ambiguous.length,
  true_positives: tp,
  false_positives_on_clean: fp,
  missed_as_no_contradiction: fnMiss,
  missed_as_unknown: fnUnknown,
  m3_baseline_contradiction_precision: precision,
  contradiction_precision_strict_ambiguous_as_fp: precisionStrict,
  contradiction_recall: recall,
  ambiguous_verdict_distribution: {
    contradiction: fpAmbiguous,
    "no-contradiction": ambiguous.filter((r) => r.verdict === "no-contradiction").length,
    unknown: ambiguous.filter((r) => r.verdict === "unknown").length,
  },
  unknown_rate_overall: +(
    results.filter((r) => r.verdict === "unknown").length / results.length
  ).toFixed(4),
  malformed_output_rate: +(
    results.filter((r) => r.malformed_output).length / results.length
  ).toFixed(4),
  calibration: {
    mean_confidence_correct: meanConf(results.filter((r) => r.correct === true)),
    mean_confidence_incorrect: meanConf(results.filter((r) => r.correct === false)),
    mean_confidence_on_ambiguous: meanConf(ambiguous),
  },
  total_cost_usd: +results.reduce((s, r) => s + (r.cost_usd ?? 0), 0).toFixed(4),
};

fs.writeFileSync(outFile, JSON.stringify({ summary, results }, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
