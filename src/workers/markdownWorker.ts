/**
 * Web Worker for markdown parsing.
 *
 * Offloads CPU-intensive markdown parsing from the main thread
 * to prevent UI blocking during large document operations.
 *
 * The worker parses markdown to MDAST (serializable) and returns it.
 * MDAST → ProseMirror conversion happens on the main thread since
 * ProseMirror Schema has non-serializable methods.
 *
 * @module workers/markdownWorker
 */

import { parseMarkdownToMdast } from "../utils/markdownPipeline/parser";
import {
  parseMarkdownToMdastFast,
  canUseFastParser,
} from "../utils/markdownPipeline/fastParser";
import type { MarkdownPipelineOptions } from "../utils/markdownPipeline/types";

/**
 * Message sent to the worker for parsing.
 */
export interface ParseRequest {
  type: "parse";
  id: string;
  markdown: string;
  options?: MarkdownPipelineOptions;
}

/**
 * Success response from the worker.
 */
export interface ParseSuccessResponse {
  type: "parse-success";
  id: string;
  mdast: unknown; // Root MDAST node (serializable)
}

/**
 * Error response from the worker.
 */
export interface ParseErrorResponse {
  type: "parse-error";
  id: string;
  error: string;
}

export type WorkerMessage = ParseRequest;
export type WorkerResponse = ParseSuccessResponse | ParseErrorResponse;

/**
 * Handle incoming parse requests.
 */
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  if (message.type === "parse") {
    try {
      // Use fast parser (markdown-it, ~42x faster) for standard markdown
      // Fall back to remark for math, wiki links, and custom syntax
      const mdast = canUseFastParser(message.markdown)
        ? parseMarkdownToMdastFast(message.markdown)
        : parseMarkdownToMdast(message.markdown, message.options);
      const response: ParseSuccessResponse = {
        type: "parse-success",
        id: message.id,
        mdast,
      };
      self.postMessage(response);
    } catch (error) {
      const response: ParseErrorResponse = {
        type: "parse-error",
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      };
      self.postMessage(response);
    }
  }
};
