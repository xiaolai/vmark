/**
 * AI Genies Types
 *
 * Core types for the AI genies system — genie definitions,
 * provider configuration, and streaming response chunks.
 */

// ============================================================================
// Genie Types
// ============================================================================

export type GenieScope = "selection" | "block" | "document";

export type GenieAction = "replace" | "insert";

export interface GenieMetadata {
  name: string;
  description: string;
  scope: GenieScope;
  category?: string;
  model?: string;
  /** Suggestion type: "replace" (default) or "insert" (append after source). */
  action?: GenieAction;
  /** Number of surrounding blocks to include as context (0–2). */
  context?: number;
}

/** Whether a genie is a one-shot markdown prompt or a multi-step YAML workflow.
 *  Mirrors the Rust enum `genies::types::GenieKind` (WI-7.1). */
type GenieKind = "markdown" | "workflow";

export interface GenieDefinition {
  metadata: GenieMetadata;
  template: string;
  filePath: string;
  source: "global";
  /** Defaults to "markdown" for backward compatibility — Rust always
   *  populates this for newly listed entries. */
  kind?: GenieKind;
}

// ============================================================================
// Genie Spec v1 (Typed Input/Output for Workflows)
// ============================================================================

// ============================================================================
// Provider Types
// ============================================================================

type CliProviderType = "claude" | "codex" | "gemini" | "ollama";
export type RestProviderType =
  | "anthropic"
  | "openai"
  | "openai-compatible"
  | "google-ai"
  | "ollama-api";
export type ProviderType = CliProviderType | RestProviderType;

export interface CliProviderInfo {
  type: CliProviderType;
  name: string;
  command: string;
  available: boolean;
  path?: string;
}

export interface RestProviderConfig {
  type: RestProviderType;
  name: string;
  endpoint: string;
  apiKey: string;
  model: string;
}

// ============================================================================
// Streaming Response
// ============================================================================

export interface AiResponseChunk {
  requestId: string;
  chunk: string;
  done: boolean;
  error?: string;
}
