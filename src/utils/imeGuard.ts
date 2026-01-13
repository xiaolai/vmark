import type { Command } from "@tiptap/pm/state";
import type { EditorView as ProseMirrorView } from "@tiptap/pm/view";
import type { EditorView as CodeMirrorView, KeyBinding } from "@codemirror/view";

type ImeKeyEvent = {
  isComposing?: boolean;
  keyCode?: number;
};

const IME_KEYCODE = 229;
const IME_GRACE_PERIOD_MS = 50;
const CJK_COMPOSED_RE = /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/;
const PINYIN_PREFIX_RE = /^[A-Za-z0-9;'\s]+$/;
const PINYIN_PREFIX_WITH_NEWLINE_RE = /^[A-Za-z0-9;'\s\n]+$/;

const proseMirrorQueue = new WeakMap<ProseMirrorView, Array<() => void>>();
const codeMirrorQueue = new WeakMap<CodeMirrorView, Array<() => void>>();
const proseMirrorCompositionEndAt = new WeakMap<ProseMirrorView, number>();
const codeMirrorCompositionEndAt = new WeakMap<CodeMirrorView, number>();

const nowMs = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

export function isImeKeyEvent(event: ImeKeyEvent | null | undefined): boolean {
  if (!event) return false;
  return Boolean(event.isComposing || event.keyCode === IME_KEYCODE);
}

export function isProseMirrorComposing(view: ProseMirrorView | null | undefined): boolean {
  return Boolean(view && view.composing);
}

export function isCodeMirrorComposing(view: CodeMirrorView | null | undefined): boolean {
  if (!view) return false;
  return Boolean(view.composing || view.compositionStarted);
}

export function markProseMirrorCompositionEnd(view: ProseMirrorView): void {
  proseMirrorCompositionEndAt.set(view, nowMs());
}

export function markCodeMirrorCompositionEnd(view: CodeMirrorView): void {
  codeMirrorCompositionEndAt.set(view, nowMs());
}

export function isProseMirrorInCompositionGrace(view: ProseMirrorView | null | undefined): boolean {
  if (!view) return false;
  const last = proseMirrorCompositionEndAt.get(view);
  if (!last) return false;
  return nowMs() - last < IME_GRACE_PERIOD_MS;
}

export function isCodeMirrorInCompositionGrace(view: CodeMirrorView | null | undefined): boolean {
  if (!view) return false;
  const last = codeMirrorCompositionEndAt.get(view);
  if (!last) return false;
  return nowMs() - last < IME_GRACE_PERIOD_MS;
}

export function guardProseMirrorCommand(command: Command): Command {
  return (state, dispatch, view) => {
    if (isProseMirrorComposing(view) || isProseMirrorInCompositionGrace(view)) return false;
    return command(state, dispatch, view);
  };
}

export function guardCodeMirrorKeyBinding(binding: KeyBinding): KeyBinding {
  const guard = (fn?: (view: CodeMirrorView) => boolean) => {
    if (!fn) return fn;
    return (view: CodeMirrorView) => {
      if (isCodeMirrorComposing(view) || isCodeMirrorInCompositionGrace(view)) return false;
      return fn(view);
    };
  };

  return {
    ...binding,
    run: guard(binding.run),
    shift: guard(binding.shift),
  };
}

export function runOrQueueProseMirrorAction(view: ProseMirrorView, action: () => void): void {
  if (!isProseMirrorComposing(view)) {
    action();
    return;
  }

  const queue = proseMirrorQueue.get(view) ?? [];
  queue.push(action);
  proseMirrorQueue.set(view, queue);
}

export function flushProseMirrorCompositionQueue(view: ProseMirrorView): void {
  const queue = proseMirrorQueue.get(view);
  if (!queue || queue.length === 0) return;
  proseMirrorQueue.delete(view);
  queue.forEach((action) => action());
}

export function runOrQueueCodeMirrorAction(view: CodeMirrorView, action: () => void): void {
  if (!isCodeMirrorComposing(view)) {
    action();
    return;
  }

  const queue = codeMirrorQueue.get(view) ?? [];
  queue.push(action);
  codeMirrorQueue.set(view, queue);
}

export function flushCodeMirrorCompositionQueue(view: CodeMirrorView): void {
  const queue = codeMirrorQueue.get(view);
  if (!queue || queue.length === 0) return;
  codeMirrorQueue.delete(view);
  queue.forEach((action) => action());
}

type ImeCleanupOptions = {
  allowNewlines?: boolean;
};

export function getImeCleanupPrefixLength(
  text: string,
  composed: string,
  options: ImeCleanupOptions = {}
): number | null {
  if (!composed) return null;
  if (!CJK_COMPOSED_RE.test(composed)) return null;
  if (!text.endsWith(composed)) return null;

  const prefix = text.slice(0, text.length - composed.length);
  if (!prefix) return null;
  const prefixPattern = options.allowNewlines ? PINYIN_PREFIX_WITH_NEWLINE_RE : PINYIN_PREFIX_RE;
  if (!prefixPattern.test(prefix)) return null;
  if (!/[A-Za-z]/.test(prefix)) return null;
  return prefix.length;
}
