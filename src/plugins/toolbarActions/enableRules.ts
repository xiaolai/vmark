import type { EditorView as TiptapEditorView } from "@tiptap/pm/view";
import { isSeparator, type ToolbarGroupButton, type ToolbarMenuItem, type ToolbarActionItem } from "@/components/Editor/UniversalToolbar/toolbarGroups";
import type { CursorContext as WysiwygContext } from "@/plugins/toolbarContext/types";
import type { CursorContext as SourceContext } from "@/types/cursorContext";
import type { ToolbarContext } from "./types";
import { canRunActionInMultiSelection } from "./multiSelectionPolicy";

export interface ToolbarItemState {
  disabled: boolean;
  notImplemented: boolean;
  active: boolean;
}

interface ToolbarButtonState extends ToolbarItemState {
  itemStates?: ToolbarItemState[];
}

// All Source mode actions are now implemented
const SOURCE_UNIMPLEMENTED_ACTIONS = new Set<string>([]);

const SOURCE_SELECTION_REQUIRED_ACTIONS = new Set<string>([
  "bold",
  "italic",
  "strikethrough",
  "highlight",
  "superscript",
  "subscript",
  "code",
  "underline",
  "clearFormatting",
  "insertFootnote",
]);

// Actions that should be disabled when cursor is inside a link
const LINK_DISABLED_ACTIONS = new Set<string>([
  "link",
  "link:bookmark",
  "link:wiki",
  "code", // Prevent code mark inside links
]);

function isDisabledInLink(action: string, ctx: WysiwygContext | SourceContext | null): boolean {
  if (!ctx) return false;
  if (!ctx.inLink) return false;
  return LINK_DISABLED_ACTIONS.has(action);
}


function isWysiwygMarkActive(view: TiptapEditorView, markName: string): boolean {
  const { state } = view;
  const markType = state.schema.marks[markName];
  if (!markType) return false;

  const { from, to, empty } = state.selection;
  if (empty) {
    const marks = state.storedMarks || state.selection.$from.marks();
    return Boolean(markType.isInSet(marks));
  }

  return state.doc.rangeHasMark(from, to, markType);
}

function isWysiwygActionActive(action: string, context: WysiwygContext | null, view: TiptapEditorView | null): boolean {
  if (!context || !view) return false;

  if (action.startsWith("heading:")) {
    const level = Number(action.split(":")[1]);
    if (Number.isNaN(level)) return false;
    // Level 0 means "remove heading" - it's an action, not a state, so never "active"
    if (level === 0) return false;
    // Only mark heading levels as active when actually inside that heading
    if (!context.inHeading) return false;
    return context.inHeading.level === level;
  }

  // Insert actions are never "active" (they insert new content)
  if (action.startsWith("link:") || action.startsWith("insert")) {
    return false;
  }

  switch (action) {
    case "bold":
      return isWysiwygMarkActive(view, "bold");
    case "italic":
      return isWysiwygMarkActive(view, "italic");
    case "underline":
      return isWysiwygMarkActive(view, "underline");
    case "strikethrough":
      return isWysiwygMarkActive(view, "strike");
    case "highlight":
      return isWysiwygMarkActive(view, "highlight");
    case "superscript":
      return isWysiwygMarkActive(view, "superscript");
    case "subscript":
      return isWysiwygMarkActive(view, "subscript");
    case "code":
      return isWysiwygMarkActive(view, "code");
    case "link":
      return Boolean(context.inLink) || isWysiwygMarkActive(view, "link");
    case "bulletList":
      return context.inList?.listType === "bullet";
    case "orderedList":
      return context.inList?.listType === "ordered";
    case "taskList":
      return context.inList?.listType === "task";
    case "heading":
      return Boolean(context.inHeading);
    default:
      return false;
  }
}

function isSourceActionActive(action: string, context: SourceContext | null): boolean {
  if (!context) return false;

  if (action.startsWith("heading:")) {
    const level = Number(action.split(":")[1]);
    if (Number.isNaN(level)) return false;
    // Level 0 means "remove heading" - it's an action, not a state, so never "active"
    if (level === 0) return false;
    // Only mark heading levels as active when actually inside that heading
    if (!context.inHeading) return false;
    return context.inHeading.level === level;
  }

  // Insert actions are never "active" (they insert new content)
  if (action.startsWith("link:") || action.startsWith("insert")) {
    return false;
  }

  switch (action) {
    case "bold":
    case "italic":
    case "strikethrough":
    case "highlight":
    case "superscript":
    case "subscript":
    case "code":
    case "underline":
      return context.activeFormats.includes(action as SourceContext["activeFormats"][number]);
    case "link":
      return Boolean(context.inLink);
    case "bulletList":
      return context.inList?.type === "bullet";
    case "orderedList":
      return context.inList?.type === "ordered";
    case "taskList":
      return context.inList?.type === "task";
    case "heading":
      return Boolean(context.inHeading);
    default:
      return false;
  }
}

function matchesEnabledContext(enabled: ToolbarActionItem["enabledIn"], ctx: WysiwygContext | SourceContext | null): boolean {
  if (!ctx) return false;

  for (const rule of enabled) {
    switch (rule) {
      case "always":
        return true;
      case "selection":
        if (ctx.hasSelection) return true;
        break;
      case "textblock":
        if (!ctx.inCodeBlock) return true;
        break;
      case "heading":
        if (ctx.inHeading) return true;
        break;
      case "list":
        if (ctx.inList) return true;
        break;
      case "table":
        if (ctx.inTable) return true;
        break;
      case "blockquote":
        if (ctx.inBlockquote) return true;
        break;
      case "codeblock":
        if (ctx.inCodeBlock) return true;
        break;
      case "never":
        break;
    }
  }

  return false;
}

function isActionImplemented(action: string, surface: ToolbarContext["surface"]): boolean {
  if (surface === "source") {
    return !SOURCE_UNIMPLEMENTED_ACTIONS.has(action);
  }

  return true;
}

function shouldRequireSelection(action: string, surface: ToolbarContext["surface"]): boolean {
  if (surface === "source") {
    return SOURCE_SELECTION_REQUIRED_ACTIONS.has(action);
  }
  return false;
}


export function getToolbarButtonState(
  button: ToolbarGroupButton,
  context: ToolbarContext
): ToolbarButtonState {
  if (button.items && button.items.length > 0) {
    const itemStates = button.items.map((item) => getToolbarItemState(item, context));
    const anyActive = itemStates.some((state) => state.active);
    const allNotImplemented = itemStates.every((state) => state.notImplemented);
    // Dropdown buttons are always clickable so users can see the menu,
    // even if all items inside are currently disabled (e.g., context not ready).
    // Only disable if all items are not implemented.
    return {
      disabled: allNotImplemented,
      notImplemented: allNotImplemented,
      active: anyActive,
      itemStates,
    };
  }

  const { surface } = context;
  const notImplemented = button.enabledIn.includes("never") || !isActionImplemented(button.action, surface);

  const ctx = context.context;
  const view = context.view;

  if (!view || !ctx) {
    return { disabled: true, notImplemented, active: false };
  }

  const enabled = matchesEnabledContext(button.enabledIn, ctx) &&
    (!shouldRequireSelection(button.action, surface) || ctx.hasSelection) &&
    canRunActionInMultiSelection(button.action, context.multiSelection) &&
    !isDisabledInLink(button.action, ctx);

  const active = surface === "wysiwyg"
    ? isWysiwygActionActive(
        button.action,
        ctx as WysiwygContext,
        (view as TiptapEditorView | null)
      )
    : isSourceActionActive(button.action, ctx as SourceContext);

  return {
    disabled: !enabled || notImplemented,
    notImplemented,
    active,
  };
}

export function getToolbarItemState(
  item: ToolbarMenuItem,
  context: ToolbarContext
): ToolbarItemState {
  // Separators are always disabled (non-interactive visual elements)
  if (isSeparator(item)) {
    return { disabled: true, notImplemented: false, active: false };
  }

  const actionItem = item as ToolbarActionItem;
  const { surface } = context;
  const notImplemented = actionItem.enabledIn.includes("never") || !isActionImplemented(actionItem.action, surface);

  const ctx = context.context;
  const view = context.view;

  if (!view || !ctx) {
    return { disabled: true, notImplemented, active: false };
  }

  const enabled = matchesEnabledContext(actionItem.enabledIn, ctx) &&
    (!shouldRequireSelection(actionItem.action, surface) || ctx.hasSelection) &&
    canRunActionInMultiSelection(actionItem.action, context.multiSelection) &&
    !isDisabledInLink(actionItem.action, ctx);

  const active = surface === "wysiwyg"
    ? isWysiwygActionActive(
        actionItem.action,
        ctx as WysiwygContext,
        (view as TiptapEditorView | null)
      )
    : isSourceActionActive(actionItem.action, ctx as SourceContext);

  return {
    disabled: !enabled || notImplemented,
    notImplemented,
    active,
  };
}
