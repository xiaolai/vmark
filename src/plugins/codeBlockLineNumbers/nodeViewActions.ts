/**
 * Action-button chrome for the code block node view: button factory and the
 * copy-feedback state machine (split from nodeView.ts for the ~300-line rule).
 *
 * @coordinates-with nodeView.ts — mounts these controls in its actions container
 * @module plugins/codeBlockLineNumbers/nodeViewActions
 */
import i18n from "@/i18n";
import { COPY_ICON_SVG, RUN_ICON_SVG } from "./icons";

/**
 * Icon-only square action in the code-block chrome. Copy and run share the
 * class deliberately: a second class would be a fourth spelling of the same
 * button — the exact drift `pnpm lint:bespoke-buttons` exists to stop.
 * `data-code-action` distinguishes them for the one rule that differs
 * (hover colour) and for test selection.
 */
export function createCodeActionButton(
  action: "copy" | "run",
  icon: string,
  labelKey: string,
  onMouseDown: (e: MouseEvent) => void,
  onClick: (e: MouseEvent) => void
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "vm-icon-btn vm-icon-btn--sm code-copy-btn";
  btn.dataset.codeAction = action;
  btn.innerHTML = icon;
  applyActionLabel(btn, labelKey);
  btn.addEventListener("mousedown", onMouseDown);
  btn.addEventListener("click", onClick);
  return btn;
}

/**
 * The language chip: interactive, keyboard-operable (WCAG), announcing its
 * dropdown via aria-haspopup/aria-expanded. Its TEXT is the language's
 * display name ("JavaScript", "Python") — proper nouns, not translatable UI
 * strings, so no t() call belongs here.
 */
export function createLanguageChip(handlers: {
  onMouseDown: (e: MouseEvent) => void;
  onKeyDown: (e: KeyboardEvent) => void;
}): HTMLElement {
  const chip = document.createElement("div");
  chip.className = "code-lang-selector";
  chip.contentEditable = "false";
  chip.setAttribute("role", "button");
  chip.tabIndex = 0;
  chip.setAttribute("aria-haspopup", "listbox");
  chip.setAttribute("aria-expanded", "false");
  // mousedown with capture so we get the event before ProseMirror does
  chip.addEventListener("mousedown", handlers.onMouseDown, { capture: true });
  chip.addEventListener("keydown", handlers.onKeyDown);
  return chip;
}

/** (Re-)translate a button's tooltip and accessible name. */
export function applyActionLabel(btn: HTMLButtonElement, labelKey: string): void {
  const label = i18n.t(labelKey);
  btn.title = label;
  btn.setAttribute("aria-label", label);
}

/**
 * Owns an action button's transient success/error feedback. One timer owns
 * the state: rapid clicks cancel the previous reset so an older timer cannot
 * cut a newer result short, and the two modifier classes never coexist.
 * `idleIcon` is what the button returns to after the feedback window (the
 * copy button restores the copy icon; the run button its run icon).
 */
export class CopyFeedback {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly btn: HTMLButtonElement,
    private readonly idleIcon: string = COPY_ICON_SVG
  ) {}

  show(icon: string, modifier: "success" | "error"): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.btn.classList.remove("code-copy-btn--success", "code-copy-btn--error");
    this.btn.innerHTML = icon;
    this.btn.classList.add(`code-copy-btn--${modifier}`);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.btn.innerHTML = this.idleIcon;
      this.btn.classList.remove("code-copy-btn--success", "code-copy-btn--error");
    }, 1500);
  }

  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/**
 * The complete actions cluster: copy + run buttons (with their feedback
 * controllers) and the language chip in one non-editable container. Copy
 * comes first: it is the older, more-used action, and existing tests select
 * the copy button as the first `.code-copy-btn` in the container. Run is
 * only meaningful for a shell fence (WI-4.3) — the node view toggles its
 * `hidden` from the language attribute.
 */
export function buildCodeBlockActions(handlers: {
  chip: HTMLElement;
  onActionMouseDown: (e: MouseEvent) => void;
  onCopyClick: (e: MouseEvent) => void;
  onRunClick: (e: MouseEvent) => void;
}): {
  container: HTMLElement;
  copyBtn: HTMLButtonElement;
  runBtn: HTMLButtonElement;
  copyFeedback: CopyFeedback;
  runFeedback: CopyFeedback;
} {
  const copyBtn = createCodeActionButton(
    "copy", COPY_ICON_SVG, "editor:plugin.copySource",
    handlers.onActionMouseDown, handlers.onCopyClick
  );
  const runBtn = createCodeActionButton(
    "run", RUN_ICON_SVG, "editor:plugin.runInTerminal",
    handlers.onActionMouseDown, handlers.onRunClick
  );
  const container = document.createElement("div");
  container.className = "code-block-actions";
  container.contentEditable = "false";
  container.appendChild(copyBtn);
  container.appendChild(runBtn);
  container.appendChild(handlers.chip);
  return {
    container,
    copyBtn,
    runBtn,
    copyFeedback: new CopyFeedback(copyBtn),
    runFeedback: new CopyFeedback(runBtn, RUN_ICON_SVG),
  };
}

/** Non-editable line-number gutter (aria-hidden: purely presentational). */
export function createGutter(): HTMLElement {
  const gutter = document.createElement("div");
  gutter.className = "code-line-numbers";
  gutter.setAttribute("aria-hidden", "true");
  gutter.contentEditable = "false";
  return gutter;
}

/** Rebuild the gutter's line-number rows for `lineCount` lines. */
export function renderLineNumbers(gutter: HTMLElement, lineCount: number): void {
  gutter.innerHTML = "";
  for (let i = 1; i <= lineCount; i++) {
    const lineNum = document.createElement("div");
    lineNum.className = "line-num";
    lineNum.textContent = String(i);
    gutter.appendChild(lineNum);
  }
}
