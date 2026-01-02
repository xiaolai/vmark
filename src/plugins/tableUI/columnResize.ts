/**
 * Column Resize
 *
 * Adds drag handles between table columns for resizing.
 * Width is stored as CSS only (resets on reload).
 */

import type { EditorView } from "@milkdown/kit/prose/view";

const MIN_COLUMN_WIDTH = 50;
const HANDLE_CLASS = "table-resize-handle";
const INIT_DELAY_MS = 100;
const DEBOUNCE_MS = 200;

interface ResizeState {
  dragging: boolean;
  tableElement: HTMLTableElement | null;
  columnIndex: number;
  startX: number;
  startWidths: number[];
}

/**
 * Create a fresh resize state.
 */
function createInitialResizeState(): ResizeState {
  return {
    dragging: false,
    tableElement: null,
    columnIndex: -1,
    startX: 0,
    startWidths: [],
  };
}

/**
 * Column resize manager - handles adding/removing resize handles to tables.
 * Each instance manages its own resize state to avoid conflicts.
 */
export class ColumnResizeManager {
  private view: EditorView;
  private observer: MutationObserver | null = null;
  private updateTimeout: ReturnType<typeof setTimeout> | null = null;
  private initTimeout: ReturnType<typeof setTimeout> | null = null;
  private resizeState: ResizeState = createInitialResizeState();

  constructor(view: EditorView) {
    this.view = view;

    // Initial setup (delayed to not interfere with editor init)
    this.initTimeout = setTimeout(() => {
      this.initTimeout = null;
      this.updateHandles();
    }, INIT_DELAY_MS);

    // NOTE: MutationObserver disabled - it interferes with ProseMirror's input handling
    // Table handle updates are triggered from plugin update() method instead
  }

  /**
   * Schedule a debounced update of resize handles.
   * Called from plugin update() to avoid synchronous DOM operations during input.
   */
  scheduleUpdate() {
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }
    this.updateTimeout = setTimeout(() => {
      this.updateTimeout = null;
      this.updateHandles();
    }, DEBOUNCE_MS);
  }

  /**
   * Update resize handles on all tables.
   */
  updateHandles() {
    const tables = this.view.dom.querySelectorAll("table");
    tables.forEach((table) => {
      this.addHandlesToTable(table as HTMLTableElement);
    });
  }

  /**
   * Add resize handles to a table.
   */
  private addHandlesToTable(table: HTMLTableElement) {
    // Get header row (first row)
    const headerRow = table.querySelector("tr");
    if (!headerRow) return;

    const cells = headerRow.querySelectorAll("th, td");

    // Add handle to each cell except the last one
    cells.forEach((cell, index) => {
      if (index >= cells.length - 1) return;

      const cellEl = cell as HTMLElement;

      // Skip if handle already exists
      if (cellEl.querySelector(`.${HANDLE_CLASS}`)) return;

      const handle = this.createHandle(table, index);
      cellEl.appendChild(handle);
    });
  }

  /**
   * Create a resize handle element.
   */
  private createHandle(table: HTMLTableElement, columnIndex: number): HTMLElement {
    const handle = document.createElement("div");
    handle.className = HANDLE_CLASS;

    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.startResize(table, columnIndex, e.clientX);
    });

    return handle;
  }

  /**
   * Start resizing a column.
   */
  private startResize(table: HTMLTableElement, columnIndex: number, startX: number) {
    const startWidths = this.getColumnWidths(table);

    this.resizeState = {
      dragging: true,
      tableElement: table,
      columnIndex,
      startX,
      startWidths,
    };

    // Add active class to the handle
    const headerRow = table.querySelector("tr");
    if (headerRow) {
      const cells = headerRow.querySelectorAll("th, td");
      const handle = cells[columnIndex]?.querySelector(`.${HANDLE_CLASS}`);
      handle?.classList.add("active");
    }

    // Add document-level listeners
    document.addEventListener("mousemove", this.handleMouseMove);
    document.addEventListener("mouseup", this.handleMouseUp);

    // Prevent text selection during drag
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }

  /**
   * Handle mouse move during resize.
   */
  private handleMouseMove = (e: MouseEvent) => {
    if (!this.resizeState.dragging || !this.resizeState.tableElement) return;

    const delta = e.clientX - this.resizeState.startX;
    const { tableElement, columnIndex, startWidths } = this.resizeState;

    // Calculate new width for the current column
    const newWidth = Math.max(MIN_COLUMN_WIDTH, startWidths[columnIndex] + delta);

    // Apply new width
    this.applyColumnWidth(tableElement, columnIndex, newWidth);
  };

  /**
   * Handle mouse up to end resize.
   */
  private handleMouseUp = () => {
    if (this.resizeState.tableElement) {
      // Remove active class from all handles
      const handles = this.resizeState.tableElement.querySelectorAll(`.${HANDLE_CLASS}`);
      handles.forEach((h) => h.classList.remove("active"));
    }

    this.resizeState = createInitialResizeState();

    // Remove document-level listeners
    document.removeEventListener("mousemove", this.handleMouseMove);
    document.removeEventListener("mouseup", this.handleMouseUp);

    // Restore normal cursor and selection
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  };

  /**
   * Get current column widths from a table.
   */
  private getColumnWidths(table: HTMLTableElement): number[] {
    const widths: number[] = [];
    const headerRow = table.querySelector("tr");
    if (!headerRow) return widths;

    const cells = headerRow.querySelectorAll("th, td");
    cells.forEach((cell) => {
      widths.push((cell as HTMLElement).offsetWidth);
    });

    return widths;
  }

  /**
   * Apply width to a specific column.
   */
  private applyColumnWidth(table: HTMLTableElement, columnIndex: number, width: number) {
    // Set table to fixed layout
    table.style.tableLayout = "fixed";

    // Apply width to all cells in the column
    const rows = table.querySelectorAll("tr");
    rows.forEach((row) => {
      const cells = row.querySelectorAll("th, td");
      const cell = cells[columnIndex] as HTMLElement | undefined;
      if (cell) {
        cell.style.width = `${width}px`;
        cell.style.minWidth = `${width}px`;
      }
    });
  }

  /**
   * Clean up.
   */
  destroy() {
    // Clear pending timeouts
    if (this.initTimeout) {
      clearTimeout(this.initTimeout);
      this.initTimeout = null;
    }
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
      this.updateTimeout = null;
    }

    // Stop observing
    this.observer?.disconnect();

    // Remove all handles
    const handles = this.view.dom.querySelectorAll(`.${HANDLE_CLASS}`);
    handles.forEach((h) => h.remove());

    // Clean up any ongoing resize
    if (this.resizeState.dragging) {
      this.handleMouseUp();
    }
  }
}
