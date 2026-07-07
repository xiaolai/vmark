/**
 * Workflow Graph Data Model
 *
 * Purpose: Shared data structures for YAML workflow parsing, React Flow
 * visualization, and execution. All renderers and consumers use these types.
 *
 * @module lib/workflow/types
 */

// ============================================================================
// Core Graph
// ============================================================================

/** Parsed workflow representation — shared model for all consumers. */
export interface WorkflowGraph {
  name: string;
  description?: string;
  triggers: WorkflowTrigger[];
  env: Record<string, string>;
  defaults: WorkflowDefaults;
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
}

export interface WorkflowStep {
  id: string;
  uses: string;
  type: "genie" | "action" | "webhook";
  label: string;
  icon: string;
  with: Record<string, string>;
  needs: string[];
  condition?: string;
  matrix?: Record<string, string[]>;
  model?: string;
  approval?: "auto" | "ask";
  limits?: WorkflowLimits;
  sourceRange?: { startLine: number; endLine: number };
  status?: "pending" | "running" | "success" | "error" | "skipped";
  duration?: number;
  error?: string;
}

export interface WorkflowEdge {
  source: string;
  target: string;
}

// ============================================================================
// Triggers
// ============================================================================

export interface WorkflowTrigger {
  type: "manual" | "schedule" | "github";
  cron?: string;
  event?: string;
  action?: string;
  branches?: string[];
  paths?: string[];
}

// ============================================================================
// Defaults & Limits
// ============================================================================

export interface WorkflowDefaults {
  model?: string;
  approval?: "auto" | "ask";
  limits?: WorkflowLimits;
}

export interface WorkflowLimits {
  timeout?: string;
  maxTokens?: number;
  maxCost?: string;
}

// ============================================================================
// Step Type Constants
// ============================================================================

export type StepType = "genie" | "action" | "webhook";
