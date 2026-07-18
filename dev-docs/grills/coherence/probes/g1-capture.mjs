#!/usr/bin/env node
// Gate G1 capture prototype (WI-0.3) — coherence-layer plan.
//
// For each write-path class in the G1 inventory (gate-g1.md), this probe
// constructs a complete spec-conformant transformation from exactly the
// fields available at that path's capture insertion point (file:line refs
// in the report), appends it to a real .vmark ledger in a temp dir per
// spec §5, then exercises the crash-recovery and idempotency protocol:
//   - torn-final-line crash -> quarantine recovery (§5.6)
//   - idempotent replay -> reader dedupe by idem (§5.1)
//   - identity-masking property: assigning vmark.id keeps content_hash (§3.3)
// Results: probes/g1-results.json. Zero npm deps; spec: coherence-format-v0.md.

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── spec §3: canonicalization + hashing ─────────────────────────────────
const canon = (text) => text.normalize("NFC").replace(/\r\n?/g, "\n");

function maskIdentity(text) {
  // Remove `vmark.id` / `vmark.schema` from the frontmatter block; drop an
  // emptied `vmark:` mapping and an emptied frontmatter block (§3.2).
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return text;
  const rest = text.slice(m[0].length);
  const lines = m[1].split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^vmark:\s*$/.test(lines[i])) {
      const kept = [];
      let j = i + 1;
      for (; j < lines.length && /^[ \t]/.test(lines[j]); j++) {
        if (!/^[ \t]+(id|schema):/.test(lines[j])) kept.push(lines[j]);
      }
      if (kept.length > 0) out.push(lines[i], ...kept);
      i = j - 1;
    } else out.push(lines[i]);
  }
  const fm = out.join("\n");
  if (fm.trim() === "") return rest;
  return `---\n${fm}\n---\n${rest}`;
}

const sha256hex = (buf) => createHash("sha256").update(buf).digest("hex");
const contentHash = (text) => "sha256:" + sha256hex(Buffer.from(maskIdentity(canon(text)), "utf8"));
const revisionId = (cHash, parents) =>
  "rev1:" + sha256hex(Buffer.from(`vmark-rev\n${cHash}\n${[...parents].sort().map((p) => p + "\n").join("")}`, "utf8"));

// ── spec §5: ledger append (O_APPEND single line + fsync) ───────────────
function appendEntry(ledgerDir, writerId, entry) {
  const seg = path.join(ledgerDir, `${writerId}.jsonl`);
  // §5.2 writer rule (G1 finding): if the segment does not end with \n (torn
  // tail from a crash), terminate the torn line first so the fragment
  // quarantines as its own malformed line instead of corrupting this entry.
  if (fs.existsSync(seg)) {
    const st = fs.statSync(seg);
    if (st.size > 0) {
      const fd0 = fs.openSync(seg, "r");
      const b = Buffer.alloc(1);
      fs.readSync(fd0, b, 0, 1, st.size - 1);
      fs.closeSync(fd0);
      if (b[0] !== 0x0a) fs.appendFileSync(seg, "\n");
    }
  }
  const line = JSON.stringify(entry) + "\n";
  if (line.includes("\n", 0) && line.indexOf("\n") !== line.length - 1) throw new Error("internal newline");
  const fd = fs.openSync(seg, "a");
  fs.writeSync(fd, line);
  fs.fsyncSync(fd);
  fs.closeSync(fd);
}

function envelope(kind, writerId, idemSeed, body) {
  return {
    format: 0,
    id: randomUUID(),
    kind,
    time: new Date().toISOString(),
    writer: writerId,
    idem: "sha256:" + sha256hex(Buffer.from(idemSeed, "utf8")),
    body,
  };
}

const txfIdem = (outputs) =>
  "txf\n" + outputs.map((o) => `${o.object}@${o.revision}`).sort().join("\n");

// ── spec §5.3/§5.4.1 schema validation (hand-rolled, fail loud) ─────────
function validateEnvelope(e) {
  const errs = [];
  if (e.format !== 0) errs.push("format");
  for (const k of ["id", "kind", "time", "writer", "idem"]) if (typeof e[k] !== "string") errs.push(k);
  if (!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(e.time ?? "")) errs.push("time-rfc3339-utc");
  if (typeof e.body !== "object" || e.body === null) errs.push("body");
  return errs;
}

function validateTransformation(b) {
  const errs = [];
  if (!Array.isArray(b.inputs)) errs.push("inputs");
  else for (const i of b.inputs) {
    if (typeof i.object !== "string" || !i.revision?.startsWith("rev1:")) errs.push("input-ref");
    if (!["direct", "contextual"].includes(i.role)) errs.push("input-role");
  }
  if (!Array.isArray(b.outputs) || b.outputs.length === 0) errs.push("outputs");
  else for (const o of b.outputs) {
    if (typeof o.object !== "string" || !o.revision?.startsWith("rev1:")) errs.push("output-ref");
    if (!o.content_hash?.startsWith("sha256:")) errs.push("output-hash");
    if (!Array.isArray(o.parents)) errs.push("output-parents");
  }
  if (!["human", "model", "external", "git"].includes(b.agent?.type)) errs.push("agent");
  if (typeof b.intent?.kind !== "string" || typeof b.intent?.summary !== "string") errs.push("intent");
  if (!["exact", "inferred", "unknown"].includes(b.confidence)) errs.push("confidence");
  return errs;
}

// ── reader with quarantine (§5.6) + idem dedupe (§5.1) ──────────────────
function readLedger(ledgerDir) {
  const entries = [];
  const quarantined = [];
  const qDir = path.join(ledgerDir, "quarantine");
  for (const f of fs.readdirSync(ledgerDir).filter((f) => f.endsWith(".jsonl"))) {
    const lines = fs.readFileSync(path.join(ledgerDir, f), "utf8").split("\n");
    lines.forEach((line, n) => {
      if (line === "") return;
      let e = null;
      try { e = JSON.parse(line); } catch { /* malformed */ }
      if (e === null || validateEnvelope(e).length > 0) {
        fs.mkdirSync(qDir, { recursive: true });
        fs.appendFileSync(path.join(qDir, `${f}.bad`), `# line ${n + 1}, malformed\n${line}\n`);
        quarantined.push({ segment: f, line: n + 1 });
      } else entries.push(e);
    });
  }
  const byIdem = new Map();
  for (const e of entries) {
    const prev = byIdem.get(e.idem);
    if (!prev || e.time < prev.time || (e.time === prev.time && e.id < prev.id)) byIdem.set(e.idem, e);
  }
  return { logical: [...byIdem.values()], raw: entries, quarantined };
}

// ── the five path-class captures ────────────────────────────────────────
const results = { paths: [], protocol: {}, pass: true };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "g1-capture-"));
const ledgerDir = path.join(tmp, ".vmark", "ledger");
fs.mkdirSync(ledgerDir, { recursive: true });
const writer = randomUUID();

const doc = (id, body) => `---\nvmark:\n  id: ${id}\n---\n${body}`;
const objScene = randomUUID(), objElena = randomUUID(), objChapter = randomUUID();

const sceneV1 = doc(objScene, "# Scene 12\nElena waited in the rain.\n");
const sceneV1Hash = contentHash(sceneV1);
const sceneR1 = revisionId(sceneV1Hash, []);
const elenaV1 = doc(objElena, "# Elena\nEyes: green. Daughter of Marcus.\n");
const elenaR1 = revisionId(contentHash(elenaV1), []);

function capture(pathClass, insertionPoint, availableFields, body) {
  const entry = envelope("transformation", writer, txfIdem(body.outputs), body);
  const errs = [...validateEnvelope(entry), ...validateTransformation(body)];
  appendEntry(ledgerDir, writer, entry);
  const complete = errs.length === 0;
  results.paths.push({ pathClass, insertionPoint, availableFields, entryId: entry.id, schemaErrors: errs, complete });
  if (!complete) results.pass = false;
  return entry;
}

// 1. Editor save (human) — saveToPath.ts:234 -> atomic_write_file.
{
  const after = sceneV1 + "\nThunder rolled.\n";
  const r2 = revisionId(contentHash(after), [sceneR1]);
  capture("editor-save (human)", "src/services/persistence/saveToPath.ts:234",
    ["tabId", "path", "content", "saveType", "prior buffer content"],
    {
      inputs: [{ object: objScene, revision: sceneR1, role: "direct" }],
      outputs: [{ object: objScene, revision: r2, content_hash: contentHash(after), parents: [sceneR1] }],
      agent: { type: "human" },
      intent: { kind: "editor-save", summary: "manual save" },
      confidence: "exact",
    });
}

// 2. Genie / AI-suggestion apply (model) — streamRunner.ts:126-178, where
//    genie.metadata.model and the ExtractionResult input set are in scope.
{
  const after = doc(objScene, "# Scene 12\nElena's green eyes narrowed against the rain.\n");
  const r2 = revisionId(contentHash(after), [sceneR1]);
  capture("genie/ai-suggestion apply (model)", "src/hooks/genieInvocation/streamRunner.ts:126-178",
    ["genie name", "genie.metadata.model", "ExtractionResult (scope, wholeDoc, context)", "target doc + prior revision", "referenced docs loaded into prompt"],
    {
      inputs: [
        { object: objScene, revision: sceneR1, role: "direct" },
        { object: objElena, revision: elenaR1, role: "direct" },
      ],
      outputs: [{ object: objScene, revision: r2, content_hash: contentHash(after), parents: [sceneR1] }],
      agent: { type: "model", id: "claude-sonnet-5" },
      intent: { kind: "genie", summary: "Revise scene to match character sheet" },
      confidence: "exact",
    });
}

// 3. MCP document.write (external agent) — mcpBridge/v2/document.ts:341-347;
//    session reads are an under-approximation of the agent's true context,
//    hence confidence=inferred (G1 finding; spec §8).
{
  const after = doc(objChapter, "# Chapter 3\nThe war began on a Tuesday.\n");
  const r1 = revisionId(contentHash(after), []);
  capture("mcp document.write (external agent)", "src/hooks/mcpBridge/v2/document.ts:341-347",
    ["tabId/filePath", "content", "MCP checkpoint (tool, contentBefore, revisions)", "session-observed document.read set"],
    {
      inputs: [{ object: objElena, revision: elenaR1, role: "direct" }],
      outputs: [{ object: objChapter, revision: r1, content_hash: contentHash(after), parents: [] }],
      agent: { type: "model", id: "mcp-client" },
      intent: { kind: "mcp-document-write", summary: "document.write via MCP bridge" },
      confidence: "inferred",
    });
}

// 4. Workflow action/save-file (model) — workflow/runner.rs:869; the runner
//    holds read-file/read-folder targets and the step outputs map.
{
  const after = "# Outline\n1. Rain. 2. War.\n";
  const r1 = revisionId(contentHash(after), []);
  const objOutline = randomUUID();
  capture("workflow save-file (model)", "src-tauri/src/workflow/runner.rs:869",
    ["step id", "action/read-file + read-folder targets", "genie step model + params", "output path + content"],
    {
      inputs: [
        { object: objScene, revision: sceneR1, role: "direct" },
        { object: objElena, revision: elenaR1, role: "contextual" },
      ],
      outputs: [{ object: objOutline, revision: r1, content_hash: contentHash(after), parents: [] }],
      agent: { type: "model", id: "workflow-genie" },
      intent: { kind: "workflow", summary: "action/save-file from workflow step" },
      confidence: "exact",
    });
}

// 5. Terminal/external edit (observed) — watcher fs:changed -> scan
//    reconciliation synthesizes observed-external with unknown inputs (R9).
{
  const after = sceneV1 + "\n(edited in vim)\n";
  const r2 = revisionId(contentHash(after), [sceneR1]);
  capture("terminal/external edit (observed)", "src-tauri/src/watcher.rs fs:changed -> scan reconciliation",
    ["path", "new content (from disk)", "last known revision (from index)"],
    {
      inputs: [],
      outputs: [{ object: objScene, revision: r2, content_hash: contentHash(after), parents: [sceneR1] }],
      agent: { type: "external" },
      intent: { kind: "observed-external-edit", summary: "content changed outside VMark" },
      confidence: "unknown",
    });
}

// ── crash recovery: torn final line (§5.2/§5.6) ─────────────────────────
{
  const seg = path.join(ledgerDir, `${writer}.jsonl`);
  fs.appendFileSync(seg, '{"format":0,"id":"018f-torn","kind":"transfor'); // no newline: torn
  const { logical, quarantined } = readLedger(ledgerDir);
  const qFile = path.join(ledgerDir, "quarantine", `${writer}.jsonl.bad`);
  results.protocol.tornLine = {
    quarantinedLines: quarantined.length,
    quarantineFileExists: fs.existsSync(qFile),
    survivingEntries: logical.length,
    pass: quarantined.length === 1 && fs.existsSync(qFile) && logical.length === 5,
  };
  if (!results.protocol.tornLine.pass) results.pass = false;
  // repair the segment the way the writer would NOT (readers never rewrite);
  // instead verify a subsequent append after the torn line still parses in
  // isolation-per-line JSONL reading. Torn line stays quarantined forever.
  appendEntry(ledgerDir, writer, envelope("navigation", writer, `nav\nx\ny\n${Date.now()}`, { git: { op: "checkout", from: "a", to: "b", ref: "main" } }));
  const again = readLedger(ledgerDir);
  results.protocol.appendAfterTear = {
    survivingEntries: again.logical.length,
    pass: again.logical.length === 6,
  };
  if (!results.protocol.appendAfterTear.pass) results.pass = false;
}

// ── idempotent replay (§5.1) ────────────────────────────────────────────
{
  const before = readLedger(ledgerDir).logical.length;
  const first = results.paths[0];
  const seg = fs.readFileSync(path.join(ledgerDir, `${writer}.jsonl`), "utf8");
  const firstEntry = seg.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .find((e) => e && e.id === first.entryId);
  const replay = { ...firstEntry, id: randomUUID(), time: new Date().toISOString() };
  appendEntry(ledgerDir, writer, replay);
  const after = readLedger(ledgerDir);
  results.protocol.idempotentReplay = {
    rawEntries: after.raw.length,
    logicalEntries: after.logical.length,
    pass: after.logical.length === before, // replay collapses by idem
  };
  if (!results.protocol.idempotentReplay.pass) results.pass = false;
}

// ── identity-masking property (§3.3) ────────────────────────────────────
{
  const noId = "---\ntitle: Elena\n---\n# Elena\nEyes: green.\n";
  const withId = `---\ntitle: Elena\nvmark:\n  id: ${randomUUID()}\n  schema: character\n---\n# Elena\nEyes: green.\n`;
  const bare = "# Free\nNo frontmatter here.\n";
  const bareWithId = `---\nvmark:\n  id: ${randomUUID()}\n---\n# Free\nNo frontmatter here.\n`;
  results.protocol.identityMasking = {
    fmPreserved: contentHash(noId) === contentHash(withId),
    fmSynthesized: contentHash(bare) === contentHash(bareWithId),
    pass: contentHash(noId) === contentHash(withId) && contentHash(bare) === contentHash(bareWithId),
  };
  if (!results.protocol.identityMasking.pass) results.pass = false;
}

// ── report ──────────────────────────────────────────────────────────────
const out = path.join(path.dirname(new URL(import.meta.url).pathname), "g1-results.json");
fs.writeFileSync(out, JSON.stringify(results, null, 2) + "\n");
console.log(`G1 capture prototype: ${results.pass ? "PASS" : "FAIL"}`);
for (const p of results.paths) console.log(`  ${p.complete ? "✓" : "✗"} ${p.pathClass}`);
for (const [k, v] of Object.entries(results.protocol)) console.log(`  ${v.pass ? "✓" : "✗"} protocol: ${k}`);
console.log(`  ledger: ${ledgerDir}`);
process.exit(results.pass ? 0 : 1);
