/**
 * AI Agent Hook
 *
 * Provides React state and controls for the Claude Agent SDK sidecar.
 * Handles streaming responses, state management, and AI operations.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Simple unique ID generator
const generateId = () => crypto.randomUUID();

// --- Types ---

export type WritingStyle = "formal" | "casual" | "concise" | "elaborate" | "academic";
export type SummaryLength = "brief" | "medium" | "detailed";

interface AgentStatus {
  running: boolean;
  claude_installed: boolean;
  claude_version: string | null;
  has_api_key: boolean;
}

interface AgentRequest {
  type: string;
  id: string;
  prompt?: string;
  options?: {
    maxTurns?: number;
    allowedTools?: string[];
    model?: string;
    systemPrompt?: string;
  };
}

interface AgentResponse {
  type: "stream" | "result" | "error" | "claude_status" | "pong" | "cancelled";
  id: string;
  content?: string;
  done?: boolean;
  installed?: boolean;
  version?: string;
  path?: string;
}

interface UseAIAgentResult {
  /** Whether the agent sidecar is running */
  running: boolean;
  /** Whether Claude Code is installed */
  claudeInstalled: boolean;
  /** Claude Code version if installed */
  claudeVersion: string | null;
  /** Whether an API key is configured */
  hasApiKey: boolean;
  /** Whether a query is currently processing */
  isProcessing: boolean;
  /** Accumulated partial content from streaming */
  partialContent: string;
  /** Error message if the last operation failed */
  error: string | null;
  /** Current request ID being processed */
  currentRequestId: string | null;

  // Actions
  /** Start the agent sidecar */
  start: () => Promise<void>;
  /** Stop the agent sidecar */
  stop: () => Promise<void>;
  /** Refresh agent status */
  refresh: () => Promise<void>;
  /** Improve selected text */
  improveWriting: (text: string, style?: WritingStyle) => Promise<string>;
  /** Translate text to a language */
  translate: (text: string, language: string) => Promise<string>;
  /** Summarize text */
  summarize: (text: string, length?: SummaryLength) => Promise<string>;
  /** Expand text with more detail */
  expand: (text: string, focus?: string) => Promise<string>;
  /** Run a custom prompt */
  customPrompt: (prompt: string, text?: string) => Promise<string>;
  /** Cancel the current operation */
  cancel: () => void;
}

// --- Hook Implementation ---

export function useAIAgent(): UseAIAgentResult {
  const [running, setRunning] = useState(false);
  const [claudeInstalled, setClaudeInstalled] = useState(false);
  const [claudeVersion, setClaudeVersion] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [partialContent, setPartialContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);

  // Refs for managing async state
  const resolveRef = useRef<((value: string) => void) | null>(null);
  const rejectRef = useRef<((error: Error) => void) | null>(null);
  const contentRef = useRef("");

  // Refresh status from backend
  const refresh = useCallback(async () => {
    try {
      const status = await invoke<AgentStatus>("agent_status");
      setRunning(status.running);
      setClaudeInstalled(status.claude_installed);
      setClaudeVersion(status.claude_version);
      setHasApiKey(status.has_api_key);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Start the agent sidecar
  const start = useCallback(async () => {
    try {
      const status = await invoke<AgentStatus>("agent_start");
      setRunning(status.running);
      setClaudeInstalled(status.claude_installed);
      setClaudeVersion(status.claude_version);
      setHasApiKey(status.has_api_key);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw new Error(message);
    }
  }, []);

  // Stop the agent sidecar
  const stop = useCallback(async () => {
    try {
      const status = await invoke<AgentStatus>("agent_stop");
      setRunning(status.running);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw new Error(message);
    }
  }, []);

  // Send a query to the agent
  const sendQuery = useCallback(
    async (
      prompt: string,
      options?: AgentRequest["options"]
    ): Promise<string> => {
      const requestId = generateId();

      return new Promise((resolve, reject) => {
        // Store resolve/reject for use in event handler
        resolveRef.current = resolve;
        rejectRef.current = reject;
        contentRef.current = "";

        setIsProcessing(true);
        setPartialContent("");
        setError(null);
        setCurrentRequestId(requestId);

        const request: AgentRequest = {
          type: "query",
          id: requestId,
          prompt,
          options: {
            maxTurns: options?.maxTurns ?? 3,
            allowedTools: options?.allowedTools ?? [
              "mcp__vmark__document_get_content",
              "mcp__vmark__selection_get",
              "mcp__vmark__selection_replace",
            ],
            ...options,
          },
        };

        invoke("agent_query", { request }).catch((err) => {
          setIsProcessing(false);
          setCurrentRequestId(null);
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          reject(new Error(message));
        });
      });
    },
    []
  );

  // Cancel current operation
  const cancel = useCallback(() => {
    if (currentRequestId) {
      const request: AgentRequest = {
        type: "cancel",
        id: currentRequestId,
      };
      invoke("agent_query", { request }).catch(() => {
        // Ignore cancel errors
      });
      setIsProcessing(false);
      setCurrentRequestId(null);
      if (rejectRef.current) {
        rejectRef.current(new Error("Cancelled"));
        rejectRef.current = null;
        resolveRef.current = null;
      }
    }
  }, [currentRequestId]);

  // AI Operations
  const improveWriting = useCallback(
    async (text: string, style: WritingStyle = "concise"): Promise<string> => {
      const styleInstructions: Record<WritingStyle, string> = {
        formal: "Make it more formal and professional",
        casual: "Make it more conversational and casual",
        concise: "Make it more concise while preserving meaning",
        elaborate: "Add more detail and explanation",
        academic: "Make it more academic and scholarly",
      };

      const prompt = `Improve the following text. ${styleInstructions[style]}. Return ONLY the improved text, nothing else.

Text to improve:
${text}`;

      return sendQuery(prompt, { maxTurns: 1 });
    },
    [sendQuery]
  );

  const translate = useCallback(
    async (text: string, language: string): Promise<string> => {
      const prompt = `Translate the following text to ${language}. Return ONLY the translated text, nothing else.

Text to translate:
${text}`;

      return sendQuery(prompt, { maxTurns: 1 });
    },
    [sendQuery]
  );

  const summarize = useCallback(
    async (text: string, length: SummaryLength = "medium"): Promise<string> => {
      const lengthInstructions: Record<SummaryLength, string> = {
        brief: "1-2 sentences",
        medium: "a short paragraph",
        detailed: "multiple paragraphs with key points",
      };

      const prompt = `Summarize the following text in ${lengthInstructions[length]}. Return ONLY the summary, nothing else.

Text to summarize:
${text}`;

      return sendQuery(prompt, { maxTurns: 1 });
    },
    [sendQuery]
  );

  const expand = useCallback(
    async (text: string, focus?: string): Promise<string> => {
      const focusInstruction = focus
        ? `Focus on: ${focus}.`
        : "Add examples, explanations, or context.";

      const prompt = `Expand the following text with more detail. ${focusInstruction} Return ONLY the expanded text, nothing else.

Text to expand:
${text}`;

      return sendQuery(prompt, { maxTurns: 1 });
    },
    [sendQuery]
  );

  const customPrompt = useCallback(
    async (prompt: string, text?: string): Promise<string> => {
      const fullPrompt = text
        ? `${prompt}

Text:
${text}`
        : prompt;

      return sendQuery(fullPrompt);
    },
    [sendQuery]
  );

  // Listen for agent responses
  useEffect(() => {
    refresh();

    const unlistenResponse = listen<AgentResponse>("agent:response", (event) => {
      const response = event.payload;

      // Only handle responses for current request
      if (response.id !== currentRequestId) return;

      switch (response.type) {
        case "stream":
          // Accumulate streaming content
          if (response.content) {
            contentRef.current += response.content;
            setPartialContent(contentRef.current);
          }
          break;

        case "result": {
          // Final result
          setIsProcessing(false);
          setCurrentRequestId(null);
          const finalContent = response.content || contentRef.current;
          setPartialContent(finalContent);
          if (resolveRef.current) {
            resolveRef.current(finalContent);
            resolveRef.current = null;
            rejectRef.current = null;
          }
          break;
        }

        case "error": {
          // Error occurred
          setIsProcessing(false);
          setCurrentRequestId(null);
          const errorMessage = response.content || "Unknown error";
          setError(errorMessage);
          if (rejectRef.current) {
            rejectRef.current(new Error(errorMessage));
            rejectRef.current = null;
            resolveRef.current = null;
          }
          break;
        }

        case "cancelled":
          setIsProcessing(false);
          setCurrentRequestId(null);
          break;
      }
    });

    const unlistenStarted = listen("agent:started", () => {
      setRunning(true);
    });

    const unlistenStopped = listen("agent:stopped", () => {
      setRunning(false);
      setIsProcessing(false);
      setCurrentRequestId(null);
    });

    return () => {
      unlistenResponse.then((fn) => fn());
      unlistenStarted.then((fn) => fn());
      unlistenStopped.then((fn) => fn());
    };
  }, [refresh, currentRequestId]);

  return {
    running,
    claudeInstalled,
    claudeVersion,
    hasApiKey,
    isProcessing,
    partialContent,
    error,
    currentRequestId,
    start,
    stop,
    refresh,
    improveWriting,
    translate,
    summarize,
    expand,
    customPrompt,
    cancel,
  };
}
