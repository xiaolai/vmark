/**
 * Agent SDK wrapper for VMark
 *
 * Provides a clean interface for running queries through the Claude Agent SDK
 * with support for streaming, MCP tools, and error handling.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { spawn } from "child_process";
import type {
  AgentRequest,
  AgentMessage,
  ClaudeStatus,
  McpServerConfig,
} from "./types.js";

/**
 * Run a query through the Agent SDK
 *
 * @param request - The agent request with prompt and options
 * @param claudePath - Path to the claude CLI executable
 * @param onMessage - Callback for streaming messages
 * @param mcpServers - Optional MCP server configurations
 */
export async function runAgentQuery(
  request: AgentRequest,
  claudePath: string,
  onMessage: (msg: AgentMessage) => void,
  mcpServers?: Record<string, McpServerConfig>
): Promise<void> {
  const { id, prompt, options } = request;

  // Build SDK options
  const sdkOptions: Parameters<typeof query>[0]["options"] = {
    maxTurns: options?.maxTurns ?? 3,
    pathToClaudeCodeExecutable: claudePath,
  };

  // Add allowed tools if specified
  if (options?.allowedTools && options.allowedTools.length > 0) {
    sdkOptions.allowedTools = options.allowedTools;
  }

  // Add MCP servers if provided
  if (mcpServers && Object.keys(mcpServers).length > 0) {
    sdkOptions.mcpServers = mcpServers;
  }

  // Add system prompt if provided
  let fullPrompt = prompt;
  if (options?.systemPrompt) {
    fullPrompt = `${options.systemPrompt}\n\n${prompt}`;
  }

  // Create the query session
  const session = query({
    prompt: fullPrompt,
    options: sdkOptions,
  });

  let finalResult = "";
  let isError = false;

  try {
    // Iterate over the async generator to get messages
    for await (const message of session) {
      // Handle streaming text (partial messages)
      if (message.type === "stream_event") {
        const event = message.event;
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          onMessage({
            type: "stream",
            id,
            content: event.delta.text,
            done: false,
          });
        }
      }

      // Handle final result
      if (message.type === "result") {
        if (message.subtype === "success") {
          finalResult = message.result;
          isError = message.is_error ?? false;
        } else if (message.subtype === "error") {
          finalResult = message.error ?? "Unknown error";
          isError = true;
        }
      }
    }
  } catch (iterError) {
    // The SDK throws when Claude exits with non-zero code
    // but we may already have the result, so check if we have content
    if (!finalResult) {
      throw iterError;
    }
    // Otherwise continue - we have the result from the messages
  }

  // Send final message
  if (isError) {
    onMessage({
      type: "error",
      id,
      content: finalResult || "Unknown error",
    });
  } else {
    onMessage({
      type: "result",
      id,
      content: finalResult || "No response",
      done: true,
    });
  }
}

/**
 * Check if Claude Code is installed and accessible
 */
export async function checkClaudeInstalled(): Promise<ClaudeStatus> {
  return new Promise((resolve) => {
    const which = spawn("which", ["claude"]);
    let path = "";

    which.stdout.on("data", (data) => {
      path += data.toString().trim();
    });

    which.on("close", (code) => {
      if (code !== 0 || !path) {
        resolve({ installed: false });
        return;
      }

      // Get version
      const claude = spawn("claude", ["--version"]);
      let version = "";

      claude.stdout.on("data", (data) => {
        version += data.toString().trim();
      });

      claude.on("close", () => {
        resolve({
          installed: true,
          version: version || undefined,
          path,
        });
      });

      claude.on("error", () => {
        resolve({ installed: true, path, version: undefined });
      });
    });

    which.on("error", () => {
      resolve({ installed: false });
    });
  });
}
