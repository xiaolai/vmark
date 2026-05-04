// WI-4.1 — IR → Mermaid flowchart string.
//
// Plan §6 Phase 4. Pure function — no DOM, no renderer dependency.
// One node per job; edges from needs[]. Reusable-workflow jobs get a
// distinct class so the Mermaid stylesheet can color them.

import type { JobIR, MatrixIR, WorkflowIR } from "../types";
import { expandMatrix } from "../parser/matrix";

const LABEL_MAX = 40;

export interface ToMermaidOptions {
  /** "TD" (top-down, default) or "LR" (left-right). */
  direction?: "TD" | "LR";
}

/**
 * Render a WorkflowIR as a Mermaid flowchart. The output is plain text
 * suitable for pasting into a markdown ` ```mermaid ` fence.
 *
 * Lossy notes (per ADR-8):
 *   - Step-level details are not rendered; one node per job only.
 *   - Status badges, action icons, and custom decorations are omitted.
 *   - Matrix shows a `×N` count or `dynamic` rather than expanding.
 */
export function toMermaid(
  workflow: WorkflowIR,
  options: ToMermaidOptions = {},
): string {
  const direction = options.direction ?? "TD";
  const lines: string[] = [`flowchart ${direction}`];

  if (workflow.jobs.length === 0) {
    lines.push("    empty[no jobs]");
    return lines.join("\n");
  }

  // Nodes.
  for (const job of workflow.jobs) {
    lines.push(`    ${jobNode(job)}`);
  }

  // Edges.
  for (const job of workflow.jobs) {
    for (const ref of job.needs) {
      lines.push(`    ${ref} --> ${job.id}`);
    }
  }

  // Reusable-workflow class.
  const reusableJobs = workflow.jobs.filter((j) => typeof j.uses === "string");
  if (reusableJobs.length > 0) {
    lines.push("    classDef reusable stroke-dasharray: 4 2");
    for (const j of reusableJobs) {
      lines.push(`    class ${j.id} reusable`);
    }
  }

  return lines.join("\n");
}

// ─── Helpers ─────────────────────────────────────────────────────────

function jobNode(job: JobIR): string {
  const label = buildLabel(job);
  return `${job.id}["${label}"]`;
}

function buildLabel(job: JobIR): string {
  const display = job.name ?? job.id;
  const truncated = truncate(display, LABEL_MAX);
  const matrixSuffix = matrixBadge(job.strategy?.matrix);
  const reusableSuffix = job.uses ? " (reusable)" : "";
  const escaped = escapeMermaidLabel(truncated);
  return `${escaped}${matrixSuffix}${reusableSuffix}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/** Escape characters that confuse Mermaid label parsing inside `["..."]`. */
function escapeMermaidLabel(s: string): string {
  return s
    .replace(/"/g, "&quot;")
    // Mermaid balks on raw `[` and `]` even inside double-quoted labels.
    .replace(/\[/g, "&#91;")
    .replace(/\]/g, "&#93;")
    // Backticks and angle brackets used by inline HTML rendering.
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function matrixBadge(matrix: MatrixIR | undefined): string {
  if (!matrix) return "";
  if (matrix.dynamic) return " ×dynamic";
  const expanded = expandMatrix(matrix);
  if (expanded.combinations.length <= 1) return "";
  return ` ×${expanded.combinations.length}`;
}
