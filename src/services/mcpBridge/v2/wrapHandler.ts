/**
 * wrapHandler — centralizes the MCP v2 handler error contract (WI-3.2, D2).
 * Runs the handler body; any thrown error becomes a structured
 * `respond({ id, success: false, error, data? })` so each handler only writes its
 * happy path (validation still uses structuredError() inside the body).
 *
 * The rendering is `bridgeErrorEnvelope`, never `String(error)`: a Rust
 * `CommandError` is a plain object, and stringifying one produced the literal
 * "[object Object]" for every typed refusal on the browser paths (audit
 * 2026-09-03, E-01).
 *
 * @coordinates-with services/mcpBridge/v2/bridgeError — the one renderer
 * @module services/mcpBridge/v2/wrapHandler
 */
import { respond } from "@/services/mcpBridge/utils";
import { bridgeErrorEnvelope } from "./bridgeError";

export async function wrapHandler(id: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const envelope = bridgeErrorEnvelope(error);
    await respond({
      id,
      success: false,
      error: envelope.error,
      ...(envelope.data ? { data: envelope.data } : {}),
    });
  }
}
