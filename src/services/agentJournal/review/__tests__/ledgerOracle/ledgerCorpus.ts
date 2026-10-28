/**
 * Ledger corpus (test support) — deterministic scenarios and explicit human
 * edit histories for the ledger oracle.
 *
 * A scenario is line-segmented: agent and human edits touch distinct lines
 * at least `gap` apart. The same final text can come from many histories,
 * and the right revert depends on which one happened (which units survived,
 * which were re-typed), so the engine is fed the OPERATIONS, never a diff of
 * snapshots.
 *   minimal: each planned human edit as one operation.
 *   mixed: each edit in a random non-minimum form (keystrokes, backspacing,
 *     retyping the line, the newline on the other side), agent edits undone
 *     by hand (just the agent's suffix, or the whole line), plus net-zero
 *     typing, an overtype anywhere (it may hit an agent hunk), an uncertified
 *     range, a line move, and one to three capture windows.
 */

import type { CertifiedOp, Op } from "./ledgerTypes";

/** mulberry32. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ["vmark", "ledger", "hunk", "revert", "agent", "diff", "anchor", "span", "文档", "编辑", "😀", "שלום", "the", "and"];

function proseLine(r: () => number, i: number): string {
  const n = 4 + Math.floor(r() * 14);
  const w: string[] = [];
  for (let k = 0; k < n; k++) w.push(WORDS[Math.floor(r() * WORDS.length)]);
  return (i % 9 === 0 ? "## " : i % 5 === 0 ? "- " : "") + w.join(" ") + ` ${i}`;
}

type EditKind = "modify" | "delete" | "insertAfter";
interface LineEdit {
  kind: EditKind;
  text: string | null;
  inserted: string;
}
const KINDS: EditKind[] = ["modify", "delete", "insertAfter"];
function edit(seed: number, i: number, line: string, tag: string): LineEdit {
  const kind = KINDS[Math.floor(rng(seed * 31 + i)() * 3)];
  const text = kind === "modify" ? `${line} [${tag}]` : kind === "delete" ? null : `${line}\n${tag} inserted line`;
  return { kind, text, inserted: `${tag} inserted line` };
}

export interface ScenarioShape {
  bytes?: number;
  lines?: number;
  alphabet?: string[];
  agentEdits: number;
  humanEdits: number;
  gap: number;
}

export interface Scenario {
  base: string;
  target: string;
  /** The agent's target lines, and the human's edits as a plan over them. */
  targetLines: string[];
  humanPlan: (LineEdit & { line: number })[];
  /** Lines the agent modified: their target-line index and the base line. */
  agentModified: { line: number; base: string }[];
}

export function segmentedScenario({ bytes, lines: nLines, alphabet, agentEdits, humanEdits, gap, seed }: ScenarioShape & { seed: number }): Scenario {
  const r = rng(seed);
  const lines: string[] = [];
  for (let i = 0, size = 0; nLines ? i < nLines : size < (bytes ?? 0); i++) {
    const l = alphabet ? alphabet[Math.floor(r() * alphabet.length)] : proseLine(r, i);
    lines.push(l);
    size += l.length + 1;
  }
  const owner = new Map<number, "a" | "h">();
  const free = (i: number) => [...owner.keys()].every((j) => Math.abs(i - j) >= gap);
  for (const [who, count] of [["a", agentEdits], ["h", humanEdits]] as const) {
    for (let placed = 0, tries = 0; placed < count && tries < count * 200; tries++) {
      const i = Math.floor(r() * lines.length);
      if (owner.has(i) || !free(i)) continue;
      owner.set(i, who);
      placed++;
    }
  }
  const edits = lines.map((l, i) => (owner.has(i) ? edit(seed, i, l, owner.get(i) === "a" ? "AGENT" : "HUMAN") : null));
  const pick = (variant: string) =>
    lines
      .map((l, i) => (edits[i] && variant.includes(owner.get(i) ?? "-") ? edits[i].text : l))
      .filter((l): l is string => l !== null)
      .map((l) => l + "\n")
      .join("");
  const targetLines: string[] = [];
  const humanPlan: Scenario["humanPlan"] = [];
  const agentModified: Scenario["agentModified"] = [];
  lines.forEach((l, i) => {
    const e = edits[i];
    if (owner.get(i) === "a" && e?.text === null) return;
    if (owner.get(i) === "a" && e?.kind === "modify") agentModified.push({ line: targetLines.length, base: l });
    if (owner.get(i) === "h" && e) humanPlan.push({ line: targetLines.length, ...e });
    targetLines.push(owner.get(i) === "a" && e?.text != null ? e.text : l);
  });
  return { base: pick(""), target: pick("a"), targetLines, humanPlan, agentModified };
}

const pickOne = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

/** `p` moved back off the middle of a surrogate pair: editor positions never split one. */
const snap = (text: string, p: number) =>
  p > 0 && p < text.length && /[\uDC00-\uDFFF]/.test(text[p]) && /[\uD800-\uDBFF]/.test(text[p - 1]) ? p - 1 : p;

/** 0 and every offset just after a newline. */
function afterNewlines(text: string): number[] {
  const out = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) out.push(i + 1);
  return out;
}

/** Typing `text` at `at`, one code point per transaction. */
function keystrokes(at: number, text: string): CertifiedOp[] {
  const ops: CertifiedOp[] = [];
  for (const ch of text) {
    ops.push([at, at, ch]);
    at += ch.length;
  }
  return ops;
}

/** Backspacing `[from, to)` one code point per transaction, from the end. */
function backspaces(text: string, from: number, to: number): CertifiedOp[] {
  const ops: CertifiedOp[] = [];
  for (let at = to; at > from; ) {
    const w = snap(text, at - 1) === at - 1 ? 1 : 2;
    ops.push([at - w, at, ""]);
    at -= w;
  }
  return ops;
}

function planOps(plan: LineEdit, start: number, len: number, r: () => number, mixed: boolean, text: string): CertifiedOp[] {
  const end = start + len;
  const next = end + 1;
  if (plan.kind === "modify") {
    const tail = (plan.text ?? "").slice(len);
    if (pickOne(r, mixed ? ["one", "keys", "retype"] : ["one"]) === "one") return [[end, end, tail]];
    return r() < 0.5 ? keystrokes(end, tail) : [[start, end, ""], [start, start, plan.text ?? ""]];
  }
  if (plan.kind === "delete") {
    const form = pickOne(r, mixed && start > 0 ? ["one", "backspace", "leading"] : ["one"]);
    if (form === "one") return [[start, next, ""]];
    if (form === "leading") return [[start - 1, end, ""]]; // the previous newline and this content
    return backspaces(text, start, next);
  }
  const form = pickOne(r, mixed ? ["one", "keys", "beforeNewline"] : ["one"]);
  if (form === "beforeNewline") return [[end, end, "\n" + plan.inserted]];
  const line = plan.inserted + "\n";
  return form === "keys" ? keystrokes(next, line) : [[next, next, line]];
}

const applyOp = (text: string, op: Op): string => {
  const [from, to, insert] = Array.isArray(op) ? (op as CertifiedOp) : (op as { uncertified: CertifiedOp }).uncertified;
  return text.slice(0, from) + insert + text.slice(to);
};

/** Revisions taking `s.target` to a human text; `mixed` histories are non-minimum. */
export function humanHistory(s: Scenario, seed: number, { mixed = false } = {}): { revisions: (readonly Op[])[]; text: string } {
  const r = rng(seed * 2654435761);
  const starts: number[] = [];
  for (let k = 0, at = 0; k < s.targetLines.length; k++) {
    starts.push(at);
    at += s.targetLines[k].length + 1;
  }
  let text = s.target;
  const ops: Op[] = [];
  const push = (op: Op) => {
    text = applyOp(text, op);
    ops.push(op);
  };
  if (mixed && r() < 0.3) {
    const p = snap(text, Math.floor(r() * (text.length + 1)));
    push([p, p, "q"]);
    push([p, p + 1, ""]);
  }
  // The human undoing an agent edit by hand: deleting just its suffix (the
  // hunk's region then holds its base text) or retyping the whole line.
  const undo = mixed ? s.agentModified.filter(() => r() < 0.3) : [];
  const steps = [
    ...s.humanPlan.map((plan) => ({ line: plan.line, ops: () => planOps(plan, starts[plan.line], s.targetLines[plan.line].length, r, mixed, text) })),
    ...undo.map(({ line, base }) => ({
      line,
      ops: (): CertifiedOp[] => {
        const start = starts[line];
        const end = start + s.targetLines[line].length;
        return r() < 0.5 ? [[start + base.length, end, ""]] : [[start, end, base]];
      },
    })),
  ];
  // Bottom-up keeps the positions above valid.
  for (const step of steps.sort((x, y) => y.line - x.line)) for (const op of step.ops()) push(op);
  if (mixed && text.length > 0 && r() < 0.15) {
    const p = snap(text, Math.floor(r() * text.length));
    push([p, p + ((text.codePointAt(p) ?? 0) > 0xffff ? 2 : 1), "Q"]);
  }
  if (mixed && r() < 0.1) {
    const p = snap(text, Math.floor(r() * (text.length + 1)));
    push({ uncertified: [p, snap(text, Math.min(text.length, p + 1 + Math.floor(r() * 3))), "U"] });
  }
  if (mixed && r() < 0.1) {
    const from = pickOne(r, afterNewlines(text).filter((p) => p < text.length));
    const endNl = text.indexOf("\n", from);
    if (endNl >= 0) {
      const line = text.slice(from, endNl + 1);
      push([from, endNl + 1, ""]);
      const to = pickOne(r, afterNewlines(text));
      push([to, to, line]);
    }
  }
  const cuts = mixed ? [...new Set([Math.floor(r() * ops.length), Math.floor(r() * ops.length)])].sort((a, b) => a - b) : [];
  const revisions: (readonly Op[])[] = [];
  let prev = 0;
  for (const c of [...cuts, ops.length]) {
    if (c > prev) revisions.push(ops.slice(prev, c));
    prev = Math.max(prev, c);
  }
  return { revisions: revisions.length ? revisions : [ops], text };
}
