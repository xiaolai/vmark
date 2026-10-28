/**
 * Journal actor — the MCP attribution of a request as the journal records
 * it (`Actor::Mcp` in Rust): principal state, connection id, and the
 * client's untrusted session label and display name; and the reading of any
 * recorded actor back from a reply (`parseJournalActor`), the four
 * principal states kept apart.
 *
 * Known limitations: the journal's `ambiguous` principal carries no
 * provider list, so the candidate providers of an ambiguous credential are
 * not recorded.
 *
 * @coordinates-with src-tauri/src/agent_journal/actor.rs — the record schema
 * @module services/agentJournal/journalActor
 */

import type { McpAttribution, McpPrincipal } from "@/services/mcpBridge/types";

type JournalPrincipal =
  | { state: "anonymous" }
  | { state: "unrecognized" }
  | { state: "ambiguous" }
  | { state: "provider"; provider: string };

export interface JournalMcpActor {
  type: "mcp";
  principal: JournalPrincipal;
  connectionId: string;
  sessionLabel?: string;
  displayName?: string;
}

/** Who made a recorded revision, as a reply carries it. */
export type JournalActor =
  | { type: "human" }
  | { type: "legacy" }
  | { type: "system"; reason: string }
  | { type: "mcp"; principal: JournalPrincipal; connectionId: string; sessionLabel: string | null; displayName: string | null };

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const optionalString = (v: unknown): string | null | undefined => (v === undefined ? null : nonEmpty(v) ? v : undefined);

function parsePrincipal(v: unknown): JournalPrincipal | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const p = v as Record<string, unknown>;
  switch (p.state) {
    case "anonymous":
    case "unrecognized":
    case "ambiguous":
      return { state: p.state };
    case "provider":
      return nonEmpty(p.provider) ? { state: "provider", provider: p.provider } : undefined;
    default:
      return undefined;
  }
}

/** Read a recorded actor from a reply; `undefined` when it is not one. */
export function parseJournalActor(v: unknown): JournalActor | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const a = v as Record<string, unknown>;
  switch (a.type) {
    case "human":
    case "legacy":
      return { type: a.type };
    case "system":
      return nonEmpty(a.reason) ? { type: "system", reason: a.reason } : undefined;
    case "mcp": {
      const principal = parsePrincipal(a.principal);
      const sessionLabel = optionalString(a.sessionLabel);
      const displayName = optionalString(a.displayName);
      if (!principal || !nonEmpty(a.connectionId) || sessionLabel === undefined || displayName === undefined) return undefined;
      return { type: "mcp", principal, connectionId: a.connectionId, sessionLabel, displayName };
    }
    default:
      return undefined;
  }
}

function principalOf(p: McpPrincipal): JournalPrincipal {
  switch (p.kind) {
    case "anonymous":
      return { state: "anonymous" };
    case "unrecognized":
      return { state: "unrecognized" };
    case "ambiguous":
      return { state: "ambiguous" };
    case "provider":
      return { state: "provider", provider: p.providerId };
  }
}

/** The journal actor for a request's attribution. Absent strings are omitted. */
export function journalActorFor(attribution: McpAttribution): JournalMcpActor {
  return {
    type: "mcp",
    principal: principalOf(attribution.principal),
    connectionId: attribution.connectionId,
    ...(attribution.sessionLabel !== null ? { sessionLabel: attribution.sessionLabel } : {}),
    ...(attribution.displayName !== null ? { displayName: attribution.displayName } : {}),
  };
}
