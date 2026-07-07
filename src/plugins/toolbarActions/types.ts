/**
 * Toolbar Actions Type Definitions
 *
 * Purpose: Shared types for the toolbar action system. Defines ToolbarContext
 * (the union type dispatchers use) and MultiSelectionContext/Policy types.
 *
 * @module plugins/toolbarActions/types
 */
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView as TiptapEditorView } from "@tiptap/pm/view";
import type { EditorView as CodeMirrorView } from "@codemirror/view";
import type { CursorContext as WysiwygCursorContext } from "@/plugins/toolbarContext/types";
import type { CursorContext as SourceCursorContext } from "@/types/cursorContext";

/** Policy controlling whether a toolbar action supports multiple selections. */
export type MultiSelectionPolicy = "allow" | "conditional" | "disallow";

/** Describes the multi-selection state and which block-level contexts the selections span. */
export interface MultiSelectionContext {
  enabled: boolean;
  reason: "multi" | "none";
  inCodeBlock: boolean;
  inTable: boolean;
  inList: boolean;
  inBlockquote: boolean;
  inHeading: boolean;
  inLink: boolean;
  inInlineMath: boolean;
  inFootnote: boolean;
  inImage: boolean;
  inTextblock: boolean;
  sameBlockParent: boolean;
  blockParentType: string | null;
}

/** Toolbar context for WYSIWYG mode with Tiptap editor and ProseMirror view. */
export interface WysiwygToolbarContext {
  surface: "wysiwyg";
  view: TiptapEditorView | null;
  editor: TiptapEditor | null;
  context: WysiwygCursorContext | null;
  multiSelection?: MultiSelectionContext;
}

/** Toolbar context for source (CodeMirror) mode with CodeMirror view. */
export interface SourceToolbarContext {
  surface: "source";
  view: CodeMirrorView | null;
  context: SourceCursorContext | null;
  multiSelection?: MultiSelectionContext;
}

/** Union type for toolbar context across both editing surfaces. */
export type ToolbarContext = WysiwygToolbarContext | SourceToolbarContext;
