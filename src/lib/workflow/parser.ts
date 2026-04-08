/**
 * Workflow YAML Parser
 *
 * Purpose: Parse YAML workflow strings into WorkflowGraph data structures.
 * Uses js-yaml for YAML parsing, then validates and normalizes into the
 * shared WorkflowGraph model.
 *
 * Key decisions:
 *   - Source line tracking via manual line scanning (js-yaml doesn't expose positions)
 *   - Sequential edges auto-generated when `needs:` is absent
 *   - Circular dependency detection via DFS
 *   - `isWorkflowYaml()` is a fast heuristic (regex, no full parse)
 *
 * @module lib/workflow/parser
 */

import jsYaml from "js-yaml";
import type {
  WorkflowGraph,
  WorkflowStep,
  WorkflowEdge,
  WorkflowTrigger,
  WorkflowDefaults,
  WorkflowLimits,
  StepType,
} from "./types";

// ============================================================================
// Error Classes
// ============================================================================

export class WorkflowParseError extends Error {
  constructor(
    message: string,
    public line?: number,
    public column?: number,
  ) {
    super(message);
    this.name = "WorkflowParseError";
  }
}

export class WorkflowValidationError extends Error {
  constructor(
    message: string,
    public stepId?: string,
  ) {
    super(message);
    this.name = "WorkflowValidationError";
  }
}

// ============================================================================
// Step Type & Icon Derivation
// ============================================================================

function deriveStepType(uses: string): StepType {
  if (uses.startsWith("genie/")) return "genie";
  if (uses.startsWith("webhook/")) return "webhook";
  return "action";
}

function deriveIcon(uses: string, type: StepType): string {
  if (type === "genie") return "🤖";
  if (type === "webhook") return "🌐";

  // Action icons based on action name
  const actionName = uses.replace("action/", "");
  if (actionName.startsWith("read")) return "📂";
  if (actionName.startsWith("save")) return "📤";
  if (actionName === "notify") return "🔔";
  if (actionName === "copy") return "📋";
  if (actionName === "prompt") return "💬";
  return "📂";
}

// ============================================================================
// Source Range Computation
// ============================================================================

/**
 * Find source line ranges for each step by scanning the YAML string for
 * `- id:` or `- uses:` patterns in the steps array.
 */
function computeSourceRanges(
  yaml: string,
  stepCount: number,
): Array<{ startLine: number; endLine: number }> {
  // Normalize line endings (CRLF/CR → LF) for consistent source range computation
  const lines = yaml.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const ranges: Array<{ startLine: number; endLine: number }> = [];
  let inSteps = false;
  let currentStepStart = -1;
  let stepItemIndent = -1; // indentation level of step list items (e.g., 2 for "  - id:")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    // Detect `steps:` block
    if (/^steps\s*:/.test(trimmed)) {
      inSteps = true;
      continue;
    }

    // Once inside steps, detect top-level step items only.
    // A step item is a `- ` at the expected indentation level (e.g., "  - id:").
    // Block-style lists under needs:/matrix: are at deeper indentation and ignored.
    if (inSteps && /^-\s+/.test(trimmed)) {
      if (stepItemIndent === -1) {
        // First list item sets the expected indentation
        stepItemIndent = indent;
      }
      if (indent === stepItemIndent) {
        // This is a top-level step entry, not a nested list
        if (currentStepStart >= 0) {
          ranges.push({ startLine: currentStepStart, endLine: i });
        }
        currentStepStart = i + 1; // 1-based line numbers
      }
    }

    // Exit steps block if we hit a top-level key (not indented, not a comment, not empty)
    if (inSteps && currentStepStart >= 0 && trimmed.length > 0 && !/^#/.test(trimmed) && indent === 0 && !/^-/.test(trimmed) && !/^steps/.test(trimmed)) {
      break;
    }
  }

  // Close last step
  if (currentStepStart >= 0) {
    ranges.push({ startLine: currentStepStart, endLine: lines.length });
  }

  // Only return if we found the right number of ranges
  if (ranges.length === stepCount) return ranges;
  return [];
}

// ============================================================================
// Trigger Parsing
// ============================================================================

function parseTriggers(on: unknown): WorkflowTrigger[] {
  if (!on || typeof on !== "object") return [];
  const triggers: WorkflowTrigger[] = [];
  const obj = on as Record<string, unknown>;

  if (obj.manual === true) {
    triggers.push({ type: "manual" });
  }

  if (Array.isArray(obj.schedule)) {
    for (const s of obj.schedule) {
      if (s && typeof s === "object" && "cron" in s) {
        triggers.push({ type: "schedule", cron: String(s.cron) });
      }
    }
  }

  if (obj.github && typeof obj.github === "object") {
    const gh = obj.github as Record<string, unknown>;
    triggers.push({
      type: "github",
      event: gh.event ? String(gh.event) : undefined,
      action: gh.action ? String(gh.action) : undefined,
      branches: Array.isArray(gh.branches) ? gh.branches.map(String) : undefined,
      paths: Array.isArray(gh.paths) ? gh.paths.map(String) : undefined,
    });
  }

  return triggers;
}

// ============================================================================
// Limits Parsing
// ============================================================================

function parseLimits(raw: unknown): WorkflowLimits | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  return {
    timeout: obj.timeout != null ? String(obj.timeout) : undefined,
    maxTokens: obj.max_tokens != null ? Number(obj.max_tokens) : undefined,
    maxCost: obj.max_cost != null ? String(obj.max_cost) : undefined,
  };
}

// ============================================================================
// Defaults Parsing
// ============================================================================

function parseDefaults(raw: unknown): WorkflowDefaults {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  return {
    model: obj.model != null ? String(obj.model) : undefined,
    approval: obj.approval === "ask" ? "ask" : obj.approval === "auto" ? "auto" : undefined,
    limits: parseLimits(obj.limits),
  };
}

// ============================================================================
// Cycle Detection
// ============================================================================

function detectCycle(steps: WorkflowStep[], edges: WorkflowEdge[]): string | null {
  const adjacency = new Map<string, string[]>();
  for (const step of steps) adjacency.set(step.id, []);
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string): string | null {
    visited.add(node);
    inStack.add(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      if (inStack.has(neighbor)) return neighbor;
      if (!visited.has(neighbor)) {
        const result = dfs(neighbor);
        if (result) return result;
      }
    }

    inStack.delete(node);
    return null;
  }

  for (const step of steps) {
    if (!visited.has(step.id)) {
      const cycleNode = dfs(step.id);
      if (cycleNode) return cycleNode;
    }
  }
  return null;
}

// ============================================================================
// Main Parser
// ============================================================================

export function parseWorkflow(yaml: string): WorkflowGraph {
  // Parse YAML
  let raw: unknown;
  try {
    raw = jsYaml.load(yaml);
  } catch (e) {
    const yamlMark =
      typeof e === "object" && e !== null && "mark" in e
        ? (e as { mark?: { line?: number; column?: number } }).mark
        : undefined;
    throw new WorkflowParseError(
      `Invalid YAML: ${e instanceof Error ? e.message : String(e)}`,
      yamlMark?.line != null ? yamlMark.line + 1 : undefined,
      yamlMark?.column,
    );
  }

  if (!raw || typeof raw !== "object") {
    throw new WorkflowValidationError("Workflow must be a YAML object");
  }

  const obj = raw as Record<string, unknown>;

  // Validate name
  if (!obj.name || typeof obj.name !== "string") {
    throw new WorkflowValidationError("Workflow must have a 'name' field");
  }

  // Validate steps
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
    throw new WorkflowValidationError("Workflow must have a non-empty 'steps' array");
  }

  // Parse steps
  const seenIds = new Set<string>();
  const steps: WorkflowStep[] = [];
  const sourceRanges = computeSourceRanges(yaml, obj.steps.length);

  for (let i = 0; i < obj.steps.length; i++) {
    const rawStep = obj.steps[i] as Record<string, unknown>;
    if (!rawStep || typeof rawStep !== "object") {
      throw new WorkflowValidationError(`Step ${i} is not a valid object`);
    }

    if (!rawStep.uses || typeof rawStep.uses !== "string") {
      throw new WorkflowValidationError(`Step ${i} must have a 'uses' field`);
    }

    const uses = rawStep.uses;
    const type = deriveStepType(uses);
    const id = rawStep.id ? String(rawStep.id) : uses.split("/").pop()!;

    // Check duplicate IDs
    if (seenIds.has(id)) {
      const hint = rawStep.id
        ? `Duplicate step ID: '${id}'`
        : `Multiple steps use '${uses}' without explicit 'id:' fields — add 'id:' to distinguish them`;
      throw new WorkflowValidationError(hint, id);
    }
    seenIds.add(id);

    // Parse needs
    let needs: string[] = [];
    if (rawStep.needs != null) {
      needs = Array.isArray(rawStep.needs)
        ? rawStep.needs.map(String)
        : [String(rawStep.needs)];
    }

    // Parse with — require scalar values (strings, numbers, booleans)
    const withObj: Record<string, string> = {};
    if (rawStep.with && typeof rawStep.with === "object") {
      for (const [k, v] of Object.entries(rawStep.with as Record<string, unknown>)) {
        if (v !== null && typeof v === "object") {
          throw new WorkflowValidationError(
            `Step '${id}' has non-scalar value for 'with.${k}' — objects and arrays are not supported`,
            id,
          );
        }
        withObj[k] = String(v ?? "");
      }
    }

    // Parse matrix
    let matrix: Record<string, string[]> | undefined;
    if (rawStep.matrix && typeof rawStep.matrix === "object") {
      matrix = {};
      for (const [k, v] of Object.entries(rawStep.matrix as Record<string, unknown>)) {
        matrix[k] = Array.isArray(v) ? v.map(String) : [String(v)];
      }
    }

    steps.push({
      id,
      uses,
      type,
      label: id,
      icon: deriveIcon(uses, type),
      with: withObj,
      needs,
      condition: rawStep.if ? String(rawStep.if) : undefined,
      matrix,
      model: rawStep.model ? String(rawStep.model) : undefined,
      approval: rawStep.approval === "ask" ? "ask" : rawStep.approval === "auto" ? "auto" : undefined,
      limits: parseLimits(rawStep.limits),
      sourceRange: sourceRanges[i] ?? undefined,
    });
  }

  // Compute edges
  const edges: WorkflowEdge[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.needs.length > 0) {
      // Validate needs references exist
      for (const dep of step.needs) {
        if (!seenIds.has(dep)) {
          throw new WorkflowValidationError(
            `Step '${step.id}' references unknown dependency '${dep}'`,
            step.id,
          );
        }
        edges.push({ source: dep, target: step.id });
      }
    } else if (i > 0) {
      // Sequential edge from previous step
      edges.push({ source: steps[i - 1].id, target: step.id });
    }
  }

  // Detect cycles
  const cycleNode = detectCycle(steps, edges);
  if (cycleNode) {
    throw new WorkflowValidationError(
      `Circular dependency detected involving step '${cycleNode}'`,
      cycleNode,
    );
  }

  // Parse env
  const env: Record<string, string> = {};
  if (obj.env && typeof obj.env === "object") {
    for (const [k, v] of Object.entries(obj.env as Record<string, unknown>)) {
      env[k] = String(v);
    }
  }

  return {
    name: String(obj.name),
    description: obj.description ? String(obj.description) : undefined,
    triggers: parseTriggers(obj.on),
    env,
    defaults: parseDefaults(obj.defaults),
    steps,
    edges,
  };
}

// ============================================================================
// Heuristic Detection
// ============================================================================

/**
 * Fast heuristic: does this string look like a workflow YAML?
 * Checks for `steps:` with at least one `uses:` entry using regex.
 * Does NOT fully parse — safe for every keystroke.
 */
export function isWorkflowYaml(yaml: string): boolean {
  if (!yaml || yaml.length < 10) return false;
  return /^steps\s*:/m.test(yaml) && /^\s+-?\s*uses\s*:/m.test(yaml);
}
