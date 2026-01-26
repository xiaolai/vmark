/**
 * VMark Agent SDK Sidecar
 *
 * Bridges Tauri <-> Claude Code via the Agent SDK.
 * Communicates via JSON lines over stdin/stdout.
 */

import * as readline from "readline";
import type { IpcRequest, IpcResponse, AgentMessage } from "./types.js";
import { runAgentQuery, checkClaudeInstalled } from "./agent.js";
import { buildMcpServersConfig, getAllowedTools } from "./mcp.js";

/**
 * Send JSON response to stdout (Tauri reads this)
 */
function sendResponse(response: IpcResponse): void {
  console.log(JSON.stringify(response));
}

/**
 * Handle a query request
 */
async function handleQuery(request: IpcRequest): Promise<void> {
  const { id, prompt, options } = request;

  if (!prompt) {
    sendResponse({
      type: "error",
      id,
      content: "Missing prompt",
    });
    return;
  }

  // Check if claude is available
  const claudeStatus = await checkClaudeInstalled();
  if (!claudeStatus.installed || !claudeStatus.path) {
    sendResponse({
      type: "error",
      id,
      content:
        "Claude Code is not installed. Please install it from https://claude.ai/code",
    });
    return;
  }

  // Build MCP servers config
  const mcpServers = await buildMcpServersConfig();

  // Message callback
  const onMessage = (msg: AgentMessage): void => {
    sendResponse(msg as IpcResponse);
  };

  // Build request with resolved tools
  const agentRequest = {
    id,
    prompt,
    options: options
      ? {
          ...options,
          allowedTools: options.allowedTools
            ? getAllowedTools(options.allowedTools as string[])
            : undefined,
        }
      : undefined,
  };

  try {
    await runAgentQuery(agentRequest, claudeStatus.path, onMessage, mcpServers);
  } catch (error) {
    sendResponse({
      type: "error",
      id,
      content: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle a check_claude request
 */
async function handleCheckClaude(id: string): Promise<void> {
  const status = await checkClaudeInstalled();
  sendResponse({
    type: "claude_status",
    id,
    installed: status.installed,
    version: status.version,
    path: status.path,
  });
}

/**
 * Process an IPC request
 */
async function processRequest(request: IpcRequest): Promise<void> {
  switch (request.type) {
    case "ping":
      sendResponse({ type: "pong", id: request.id });
      break;

    case "check_claude":
      await handleCheckClaude(request.id);
      break;

    case "query":
      await handleQuery(request);
      break;

    case "cancel":
      // TODO: Implement cancellation
      sendResponse({ type: "cancelled", id: request.id });
      break;

    default:
      sendResponse({
        type: "error",
        id: request.id,
        content: `Unknown request type: ${(request as IpcRequest).type}`,
      });
  }
}

/**
 * Main IPC loop - reads JSON lines from stdin
 */
async function main(): Promise<void> {
  // If run with --check flag, just check claude and exit
  if (process.argv.includes("--check")) {
    const status = await checkClaudeInstalled();
    console.log(JSON.stringify(status));
    process.exit(status.installed ? 0 : 1);
  }

  // If run with --test flag, run a simple test query
  if (process.argv.includes("--test")) {
    console.error("[spike] Running test query...");
    const status = await checkClaudeInstalled();
    console.error(
      `[spike] Claude installed: ${status.installed}, version: ${status.version}`
    );

    if (!status.installed) {
      console.error("[spike] ERROR: Claude Code not found");
      process.exit(1);
    }

    await handleQuery({
      type: "query",
      id: "test",
      prompt: "Say 'Hello from VMark!' and nothing else.",
      options: { maxTurns: 1, allowedTools: [] },
    });
    process.exit(0);
  }

  // Normal IPC mode - read from stdin
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  console.error("[vmark-agent-sdk] Sidecar started, waiting for requests...");

  rl.on("line", async (line) => {
    try {
      const request: IpcRequest = JSON.parse(line);
      await processRequest(request);
    } catch (error) {
      console.error("[vmark-agent-sdk] Error parsing request:", error);
    }
  });

  rl.on("close", () => {
    console.error("[vmark-agent-sdk] stdin closed, exiting");
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("[vmark-agent-sdk] Fatal error:", error);
  process.exit(1);
});
