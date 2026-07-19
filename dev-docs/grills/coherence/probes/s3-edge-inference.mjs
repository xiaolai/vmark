#!/usr/bin/env node
// Spike S3 (WI-0.7) — LLM edge-inference feasibility, coherence-layer plan.
//
// Question (O2 scoping): given a scene and 6 candidate upstream docs, can
// an LLM classify each candidate as direct / contextual / unrelated per
// spec §7 (coherence-format-v0.md)? Gates the Phase-3 human-edit
// inference design; does not change Phase 1 behavior.
//
// Method: for each of the 10 scenes in s3-corpus/ (ground truth by
// construction, see s3-corpus/ground-truth.json), one `claude -p` call
// presenting all 6 candidate docs + the scene, demanding one line of
// strict JSON. Calls run SEQUENTIALLY. Malformed output is recorded as
// verdict "malformed" (the R25 analogue of "unknown") — never guessed.
// Results (incl. raw per-scene model output): probes/s3-results.json.
// Zero npm deps.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const corpusDir = path.join(here, "s3-corpus");
const outFile = path.join(here, "s3-results.json");

const DOCS = [
  "elena.md",
  "marcus.md",
  "world-rules.md",
  "guild-law.md",
  "timeline.md",
  "style.md",
];
const ROLES = ["direct", "contextual", "unrelated"];

const groundTruth = JSON.parse(
  fs.readFileSync(path.join(corpusDir, "ground-truth.json"), "utf8"),
);
const read = (f) => fs.readFileSync(path.join(corpusDir, f), "utf8").trim();

// ── claude CLI call ─────────────────────────────────────────────────────
// cwd = os tmpdir so the CLI does not load this repo's project config.
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
    return {
      error: `exit ${r.status}: ${(r.stderr || "").slice(0, 500)}`,
      wall_ms,
    };
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
  let depth = 0;
  let inStr = false;
  let esc = false;
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
        try {
          return JSON.parse(stripped.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function normalizeAnswer(obj) {
  // Returns { direct:[], contextual:[], unrelated:[] } with known doc
  // names only, or null if the shape is unusable.
  if (!obj || typeof obj !== "object") return null;
  const out = { direct: [], contextual: [], unrelated: [] };
  for (const role of ROLES) {
    const v = obj[role];
    if (v === undefined) continue;
    if (!Array.isArray(v)) return null;
    for (const item of v) {
      if (typeof item !== "string") return null;
      const name = item.trim().toLowerCase().replace(/\.md$/, "") + ".md";
      if (DOCS.includes(name) && !out[role].includes(name)) out[role].push(name);
    }
  }
  return out;
}

// ── prompt ──────────────────────────────────────────────────────────────
function buildPrompt(sceneText) {
  const candidates = DOCS.map(
    (d) => `[CANDIDATE: ${d}]\n${read(d)}`,
  ).join("\n\n");
  return `You are analysing provenance in a fiction workspace. Below are six candidate upstream documents, then one SCENE. Classify EVERY candidate into exactly one role, judging only from the texts:

- "direct": the scene semantically depends on this document — it conforms to, derives from, or must stay consistent with specific facts in it. Editing those facts could contradict the scene.
- "contextual": the document plausibly shaped the scene's tone, style, or background, but the scene does not depend on any specific fact in it.
- "unrelated": the scene neither depends on this document nor shows its influence.

A mere mention of a name is NOT dependency; a document is "direct" only if the scene relies on its content.

${candidates}

[SCENE]
${sceneText}

Answer with exactly one line of strict JSON and nothing else — no code fences, no commentary:
{"direct": [...], "contextual": [...], "unrelated": [...]}
Use the candidate filenames. Every one of the six candidates must appear in exactly one of the three arrays.`;
}

// ── run ─────────────────────────────────────────────────────────────────
const scenes = Object.keys(groundTruth.scenes).sort();
const results = [];

for (const scene of scenes) {
  const gt = groundTruth.scenes[scene];
  process.stderr.write(`[s3] ${scene} ... `);
  const call = callClaude(buildPrompt(read(`${scene}.md`)));
  const record = {
    scene,
    ground_truth: { direct: gt.direct, contextual: gt.contextual, unrelated: gt.unrelated },
    difficulty: gt.difficulty,
    trap: gt.trap ?? null,
    model_raw: call.text ?? null,
    call_error: call.error ?? null,
    model: call.model ?? null,
    duration_ms: call.duration_ms ?? null,
    cost_usd: call.cost_usd ?? null,
  };
  const parsed = call.text ? normalizeAnswer(extractJsonObject(call.text)) : null;
  if (!parsed) {
    record.verdict = "malformed";
    record.answer = null;
    process.stderr.write(call.error ? `ERROR (${call.error})\n` : "MALFORMED\n");
  } else {
    record.verdict = "parsed";
    record.answer = parsed;
    // Per-doc comparison: for each doc, gt role vs predicted role.
    record.per_doc = DOCS.map((d) => {
      const truth = ROLES.find((r) => gt[r].includes(d)) ?? "unrelated";
      const pred = ROLES.find((r) => parsed[r].includes(d)) ?? "missing";
      return { doc: d, truth, predicted: pred, match: truth === pred };
    });
    process.stderr.write("ok\n");
  }
  results.push(record);
}

// ── metrics ─────────────────────────────────────────────────────────────
const parsedResults = results.filter((r) => r.verdict === "parsed");
const perRole = {};
for (const role of ROLES) {
  let tp = 0,
    fp = 0,
    fn = 0;
  for (const r of parsedResults) {
    for (const pd of r.per_doc) {
      if (pd.truth === role && pd.predicted === role) tp++;
      else if (pd.truth !== role && pd.predicted === role) fp++;
      else if (pd.truth === role && pd.predicted !== role) fn++;
    }
  }
  perRole[role] = {
    tp,
    fp,
    fn,
    precision: tp + fp ? +(tp / (tp + fp)).toFixed(4) : null,
    recall: tp + fn ? +(tp / (tp + fn)).toFixed(4) : null,
  };
}

const falseDirect = [];
const missedDirect = [];
for (const r of parsedResults) {
  for (const pd of r.per_doc) {
    if (pd.predicted === "direct" && pd.truth !== "direct")
      falseDirect.push({ scene: r.scene, doc: pd.doc, truth: pd.truth });
    if (pd.truth === "direct" && pd.predicted !== "direct")
      missedDirect.push({ scene: r.scene, doc: pd.doc, predicted: pd.predicted });
  }
}

const trapOutcomes = results
  .filter((r) => r.trap)
  .map((r) => ({
    scene: r.scene,
    trap_doc: r.trap.doc,
    trap_kind: r.trap.kind,
    predicted:
      r.verdict === "parsed"
        ? (r.per_doc.find((p) => p.doc === r.trap.doc)?.predicted ?? "missing")
        : "malformed",
    fooled:
      r.verdict === "parsed" &&
      r.per_doc.find((p) => p.doc === r.trap.doc)?.predicted === "direct",
  }));

const summary = {
  spike: "S3",
  date: new Date().toISOString(),
  model: results.find((r) => r.model)?.model ?? null,
  scenes_total: results.length,
  scenes_parsed: parsedResults.length,
  scenes_malformed: results.length - parsedResults.length,
  per_role: perRole,
  false_direct_edges: falseDirect,
  missed_direct_edges: missedDirect,
  trap_outcomes: trapOutcomes,
  total_cost_usd: +results
    .reduce((s, r) => s + (r.cost_usd ?? 0), 0)
    .toFixed(4),
};

fs.writeFileSync(outFile, JSON.stringify({ summary, results }, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
