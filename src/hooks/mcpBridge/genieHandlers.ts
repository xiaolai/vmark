/**
 * MCP Bridge — Genie Operation Handlers
 *
 * Purpose: Lists available AI genies, reads their definitions, and invokes
 *   them via the MCP bridge — bridges external AI clients to the genie system.
 *
 * @coordinates-with geniesStore.ts — reads genie definitions
 * @module hooks/mcpBridge/genieHandlers
 */

import { invoke } from "@tauri-apps/api/core";
import { respond } from "./utils";

interface GenieEntry {
  name: string;
  path: string;
  source: string;
  category: string | null;
}

interface GenieContent {
  metadata: {
    name: string;
    description: string;
    scope: string;
    category: string | null;
    model: string | null;
    action: string | null;
    context: number | null;
  };
  template: string;
}

/**
 * Handle genies.list request — list all available AI genies.
 */
export async function handleGeniesList(id: string): Promise<void> {
  try {
    const genies = await invoke<GenieEntry[]>("list_genies");
    await respond({ id, success: true, data: { genies } });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle genies.read request — read a specific genie's metadata and template.
 */
export async function handleGeniesRead(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const path = args.path as string;
    if (typeof path !== "string" || !path) {
      throw new Error("path is required and must be a string");
    }

    const content = await invoke<GenieContent>("read_genie", { path });
    await respond({ id, success: true, data: content });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle genies.invoke request — invoke a genie against editor content.
 *
 * This triggers the genie invocation pipeline: read genie → extract content →
 * fill template → invoke AI provider → stream response → create suggestion.
 * The result arrives asynchronously via the AI suggestion system.
 */
export async function handleGeniesInvoke(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const geniePath = args.geniePath as string;
    if (typeof geniePath !== "string" || !geniePath) {
      throw new Error("geniePath is required and must be a string");
    }

    const scope = (args.scope as string) ?? "selection";
    const validScopes = ["selection", "block", "document"];
    if (!validScopes.includes(scope)) {
      throw new Error(`Invalid scope "${scope}". Must be one of: ${validScopes.join(", ")}`);
    }

    // Read the genie file to get metadata and template
    const genie = await invoke<GenieContent>("read_genie", { path: geniePath });

    // Dispatch a custom event that useGenieInvocation can pick up.
    // The genie invocation pipeline is complex (provider detection, streaming,
    // suggestion creation) and lives in React hook land. We emit a DOM event
    // to bridge from the MCP handler to the React hook.
    const event = new CustomEvent("mcp:invoke-genie", {
      detail: {
        id,
        genie: {
          metadata: {
            name: genie.metadata.name,
            description: genie.metadata.description,
            scope: genie.metadata.scope as "selection" | "block" | "document",
            category: genie.metadata.category ?? undefined,
            model: genie.metadata.model ?? undefined,
            action: genie.metadata.action ?? undefined,
            context: genie.metadata.context ?? undefined,
          },
          template: genie.template,
          filePath: geniePath,
          source: "global" as const,
        },
        scopeOverride: scope as "selection" | "block" | "document",
      },
    });
    window.dispatchEvent(event);

    // Respond immediately — the actual AI result will arrive via the suggestion system
    await respond({
      id,
      success: true,
      data: { status: "invocation started — result will appear as an AI suggestion" },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
