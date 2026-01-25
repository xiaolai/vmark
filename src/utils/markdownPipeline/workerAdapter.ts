/**
 * Worker adapter for async markdown parsing.
 *
 * Provides a Promise-based interface for parsing markdown in a Web Worker.
 * Falls back to synchronous parsing if workers are unavailable.
 *
 * @module utils/markdownPipeline/workerAdapter
 */

import type { Schema, Node as PMNode } from "@tiptap/pm/model";
import type { Root } from "mdast";
import { mdastToProseMirror } from "./mdastToProseMirror";
import { parseMarkdown } from "./adapter";
import type { MarkdownPipelineOptions } from "./types";
import type {
  ParseRequest,
  WorkerResponse,
} from "../../workers/markdownWorker";

/**
 * Pending request tracking.
 */
interface PendingRequest {
  resolve: (mdast: Root) => void;
  reject: (error: Error) => void;
}

/**
 * Singleton worker instance and state.
 */
let worker: Worker | null = null;
let workerFailed = false;
const pendingRequests = new Map<string, PendingRequest>();
let requestIdCounter = 0;

/**
 * Size threshold for using worker (in characters).
 * Small documents parse faster synchronously due to worker overhead.
 */
const WORKER_SIZE_THRESHOLD = 10000; // ~10KB

/**
 * Generate a unique request ID.
 */
function generateRequestId(): string {
  return `parse-${++requestIdCounter}-${Date.now()}`;
}

/**
 * Initialize the worker if not already done.
 * Returns null if workers are unavailable or failed.
 */
function getWorker(): Worker | null {
  if (workerFailed) return null;

  if (!worker) {
    try {
      worker = new Worker(
        new URL("../../workers/markdownWorker.ts", import.meta.url),
        { type: "module" }
      );

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;
        const pending = pendingRequests.get(response.id);
        if (!pending) return;

        pendingRequests.delete(response.id);

        if (response.type === "parse-success") {
          pending.resolve(response.mdast as Root);
        } else {
          pending.reject(new Error(response.error));
        }
      };

      worker.onerror = (event) => {
        console.error("[MarkdownWorker] Worker error:", event.message);
        // Reject all pending requests
        for (const [id, pending] of pendingRequests) {
          pending.reject(new Error(`Worker error: ${event.message}`));
          pendingRequests.delete(id);
        }
        // Mark worker as failed for fallback
        workerFailed = true;
        worker?.terminate();
        worker = null;
      };
    } catch (error) {
      console.warn("[MarkdownWorker] Failed to create worker:", error);
      workerFailed = true;
      return null;
    }
  }

  return worker;
}

/**
 * Parse markdown to MDAST asynchronously in a Web Worker.
 * Returns a Promise that resolves to the MDAST root node.
 *
 * @param markdown - The markdown string to parse
 * @param options - Pipeline options
 * @returns Promise resolving to MDAST Root
 */
export function parseMarkdownToMdastAsync(
  markdown: string,
  options: MarkdownPipelineOptions = {}
): Promise<Root> {
  const w = getWorker();

  // Fallback to sync parsing if worker unavailable
  if (!w) {
    return Promise.resolve(
      // Dynamic import to avoid circular dependency
      import("./parser").then((m) => m.parseMarkdownToMdast(markdown, options))
    );
  }

  return new Promise((resolve, reject) => {
    const id = generateRequestId();

    pendingRequests.set(id, { resolve, reject });

    const request: ParseRequest = {
      type: "parse",
      id,
      markdown,
      options,
    };

    w.postMessage(request);
  });
}

/**
 * Parse markdown to ProseMirror document asynchronously.
 *
 * Uses Web Worker for MDAST parsing if:
 * - Document is larger than WORKER_SIZE_THRESHOLD
 * - Workers are available
 *
 * @param schema - The ProseMirror schema
 * @param markdown - The markdown string to parse
 * @param options - Pipeline options
 * @returns Promise resolving to ProseMirror document
 */
export async function parseMarkdownAsync(
  schema: Schema,
  markdown: string,
  options: MarkdownPipelineOptions = {}
): Promise<PMNode> {
  const safeMarkdown = markdown ?? "";

  // Use sync parsing for small documents (worker overhead not worth it)
  if (safeMarkdown.length < WORKER_SIZE_THRESHOLD) {
    return parseMarkdown(schema, safeMarkdown, options);
  }

  try {
    const mdast = await parseMarkdownToMdastAsync(safeMarkdown, options);
    return mdastToProseMirror(schema, mdast);
  } catch (error) {
    // Fallback to sync parsing on worker failure
    console.warn("[MarkdownWorker] Async parse failed, using sync:", error);
    return parseMarkdown(schema, safeMarkdown, options);
  }
}

/**
 * Check if async parsing is available and recommended for the given content.
 *
 * @param contentLength - Length of the markdown content
 * @returns True if async parsing should be used
 */
export function shouldUseAsyncParsing(contentLength: number): boolean {
  return contentLength >= WORKER_SIZE_THRESHOLD && !workerFailed;
}

/**
 * Terminate the worker and clean up resources.
 * Call this when async parsing is no longer needed.
 */
export function terminateWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  pendingRequests.clear();
}
