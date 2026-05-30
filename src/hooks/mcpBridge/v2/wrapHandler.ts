/**
 * wrapHandler — centralizes the MCP v2 handler error contract (WI-3.2, D2).
 * Runs the handler body; any thrown error becomes a structured
 * `respond({ id, success: false, error })` so each handler only writes its
 * happy path (validation still uses structuredError() inside the body).
 *
 * @module hooks/mcpBridge/v2/wrapHandler
 */
import { respond } from "../utils";
import { errorMessage } from "@/utils/errorMessage";

export async function wrapHandler(id: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    await respond({ id, success: false, error: errorMessage(error) });
  }
}
