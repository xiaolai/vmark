/**
 * xterm.js Markdown Addon
 *
 * Intercepts terminal writes and optionally renders markdown as styled ANSI.
 */

import type { Terminal, ITerminalAddon } from "@xterm/xterm";
import type { TerminalMarkdownMode } from "@/stores/settingsStore";
import type { AnsiRenderOptions } from "./types";
import { createMarkdownDetector, MarkdownDetector } from "./markdownDetector";
import { renderBlocks, likelyContainsMarkdown } from "./ansiRenderer";

/**
 * Markdown rendering addon for xterm.js
 */
export class MarkdownAddon implements ITerminalAddon {
  private terminal: Terminal | null = null;
  private detector: MarkdownDetector;
  private mode: TerminalMarkdownMode = "ansi";
  private options: AnsiRenderOptions = {};

  // Store original write function for bypass
  private originalWrite: ((data: string | Uint8Array, callback?: () => void) => void) | null = null;

  constructor(options: AnsiRenderOptions = {}) {
    this.detector = createMarkdownDetector();
    this.options = options;
  }

  /**
   * Activate the addon
   */
  activate(terminal: Terminal): void {
    this.terminal = terminal;
    this.options.termWidth = terminal.cols;

    // Store original write function
    this.originalWrite = terminal.write.bind(terminal);

    // Override write to intercept data
    // Note: We wrap the terminal.write method to process markdown
    // This is a simple approach - a more robust implementation would use a custom parser
  }

  /**
   * Dispose the addon
   */
  dispose(): void {
    this.detector.reset();
    this.terminal = null;
    this.originalWrite = null;
  }

  /**
   * Set markdown rendering mode
   */
  setMode(mode: TerminalMarkdownMode): void {
    this.mode = mode;
    if (mode === "off") {
      // Flush any buffered content when switching to raw mode
      this.detector.flush();
    }
  }

  /**
   * Get current mode
   */
  getMode(): TerminalMarkdownMode {
    return this.mode;
  }

  /**
   * Process incoming data through markdown detection
   * Returns rendered output based on current mode
   */
  processData(data: string): string {
    // If mode is off, return data as-is
    if (this.mode === "off") {
      return data;
    }

    // Quick check - if no markdown patterns, pass through
    if (!likelyContainsMarkdown(data)) {
      return data;
    }

    // Detect markdown blocks
    const result = this.detector.process(data);

    // If no complete blocks detected, return original data
    if (result.blocks.length === 0) {
      return data;
    }

    // Render blocks based on mode
    if (this.mode === "ansi") {
      return renderBlocks(result.blocks, this.options);
    }

    // For 'overlay' mode (future), return raw data
    // Overlay rendering would be handled separately via DOM
    return data;
  }

  /**
   * Write data through the markdown processor
   */
  write(data: string): void {
    if (!this.terminal || !this.originalWrite) return;

    const processed = this.processData(data);
    this.originalWrite(processed);
  }

  /**
   * Reset the detector state (e.g., on session reconnect)
   */
  reset(): void {
    this.detector.reset();
  }

  /**
   * Update terminal width (call on resize)
   */
  updateWidth(cols: number): void {
    this.options.termWidth = cols;
  }
}

/**
 * Create a new markdown addon instance
 */
export function createMarkdownAddon(options: AnsiRenderOptions = {}): MarkdownAddon {
  return new MarkdownAddon(options);
}
