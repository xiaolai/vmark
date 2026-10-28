/**
 * MCP connection lifetimes — which connections the read tracker
 * (`mcpReads.ts`) still treats as open.
 *
 * Purpose: a batch of reads detached for a write holds its connection's
 *   lifetime, so a write that fails after the connection closed (or the bridge
 *   stopped) cannot give its reads back. The batch carries the lifetime itself
 *   rather than looking the id up later, so the refusal survives however many
 *   closes follow.
 *
 * Key decisions:
 *   - Connection ids are never reused: a closed id is tombstoned (bounded), and
 *     a late read under it is refused.
 *   - A stopped bridge ends every lifetime but tombstones no id: a read
 *     handler takes its connection's lifetime when the request begins and
 *     records only while that lifetime is open, so no read from a stopped
 *     lifetime lands after the stop (and none recreates a partition).
 *   - Both maps are bounded. Past the cap the oldest open lifetime is ended
 *     (fail closed): it records no further reads and its batches stay detached.
 *
 * @coordinates-with mcpReads.ts — the read sets these lifetimes guard
 * @module services/coherence/mcpConnectionLifetimes
 */

/** One connection's lifetime; `closed` once it is announced closed or the
 *  bridge stops. */
export interface ConnectionLifetime {
  readonly closed: boolean;
}

interface MutableLifetime {
  closed: boolean;
}

const MAX_CLOSED_CONNECTIONS = 1024;
const MAX_OPEN_LIFETIMES = MAX_CLOSED_CONNECTIONS;
/** Connection ids announced closed, oldest first; bounded. */
const closedConnections = new Set<string>();
/** connectionId → lifetime, for connections not yet closed, oldest first. */
const openLifetimes = new Map<string, MutableLifetime>();
/** The lifetime handed out for a connection already closed. */
const CLOSED: ConnectionLifetime = Object.freeze({ closed: true });

/** The connection's current lifetime, begun when it is first seen. */
export function lifetimeOf(connectionId: string): ConnectionLifetime {
  if (closedConnections.has(connectionId)) return CLOSED;
  const known = openLifetimes.get(connectionId);
  if (known) return known;
  if (openLifetimes.size >= MAX_OPEN_LIFETIMES) {
    const oldest = openLifetimes.keys().next().value;
    if (oldest !== undefined) endLifetime(oldest);
  }
  const fresh: MutableLifetime = { closed: false };
  openLifetimes.set(connectionId, fresh);
  return fresh;
}

/** The connection closed: its lifetime ends and its id is tombstoned. */
export function endLifetime(connectionId: string): void {
  const lifetime = openLifetimes.get(connectionId);
  if (lifetime) lifetime.closed = true;
  openLifetimes.delete(connectionId);
  closedConnections.delete(connectionId);
  closedConnections.add(connectionId);
  if (closedConnections.size > MAX_CLOSED_CONNECTIONS) {
    const oldest = closedConnections.values().next().value;
    if (oldest !== undefined) closedConnections.delete(oldest);
  }
}

/** The bridge stopped: every lifetime seen so far ends. */
export function endAllLifetimes(): void {
  for (const lifetime of openLifetimes.values()) lifetime.closed = true;
  openLifetimes.clear();
}
