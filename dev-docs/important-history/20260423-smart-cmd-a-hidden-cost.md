# Smart Cmd+A: The Hidden Cost of Replacing a Universal Convention

**Date**: 2026-04-23
**Context**: Issue [#816](https://github.com/xiaolai/vmark/issues/816) — "[Bug] 全选文本不能取消"
**Fix commit**: `85a67bd3`
**Related**: `src/plugins/smartSelectAll/`, `src/plugins/editorPlugins/keymapUtils.ts`

## What We Built

"Smart Select-All" in WYSIWYG mode: progressive block expansion. Each Cmd+A press selects the next-larger container (cell → row → table → document) rather than jumping straight to the whole document. Selection changes are undoable via Cmd+Z. It's a genuinely nice feature — it matches VS Code's "Expand Selection", just bound to a more discoverable shortcut.

## What It Cost Us

A bug report arrived within days of 0.6.50 shipping:

> 全部选择文本之后，只能取消一部分选择状态，不能全部取消选择的文本
> ("After selecting all text, only part of the selection can be cancelled; I cannot cancel all of the selected text.")

The report didn't describe our feature. It described what the user saw when our feature violated their expectation. Three compounding failures produced that appearance:

1. **Progressive expansion surprised the user.** First Cmd+A inside a container selects only that container. The user perceives this as "select all" because the block often fills the viewport. Clicking elsewhere deselects that block — which looks like "partial deselection" because they never noticed only one block was selected.

2. **`TextSelection(0, docSize)` left visual gaps.** When the plugin finally expanded to "whole document" via the progressive-expansion stack, it dispatched a TextSelection spanning the full range. ProseMirror silently snaps TextSelection endpoints to the nearest inline position, leaving unhighlighted gaps at atom-block boundaries. A few of those gaps turn into "this part didn't get selected" to a user verifying their selection.

3. **Esc did nothing for selections.** Our Escape handler only escaped mark boundaries. Every other editor — VS Code, Typora, Google Docs, MS Word — lets Esc collapse a selection. Users reach for it instinctively. Ours did nothing.

None of these was wrong in isolation. Progressive expansion is genuinely useful. `TextSelection(0, docSize)` is the naive-correct way to select everything when you don't know `AllSelection` exists. `escapeMarkBoundary` does exactly what its name says. The bug was that users who press Cmd+A carry a **firm mental model** — "everything I see is selected; clicking deselects; Esc deselects" — and our implementation violated every one of those assumptions simultaneously.

## The General Lesson

**A feature that replaces a universal convention carries a debt that scales with user surprise.** You don't pay the debt when you ship. You pay it when users hit the feature expecting the old behavior and report bugs that aren't about your feature at all.

The tell: the user filed a bug titled "cannot cancel selection", not "Cmd+A behaves unexpectedly". They didn't perceive our feature — they perceived a broken editor. That's what replacing a universal convention looks like from the outside.

## Checklist for "Nice Feature" Decisions

Before replacing a universal keyboard convention (Cmd+A, Cmd+Z, Cmd+C, Esc, Arrow keys) or a universal UI expectation (click-to-deselect, Esc-to-cancel, Tab-to-focus-next):

1. **Does the universally-bound behavior currently work correctly?** If yes, the debt floor for any replacement is non-zero — the new behavior must also deliver every side effect of the original.
2. **What does the user assume their action did?** Simulate the gap between intent and visible result. Fill the gap or you've shipped a bug.
3. **Is there a second key for the new behavior?** `Cmd+Shift+A` for "expand selection" is a zero-friction way to add the feature without displacing the convention. We did not ship this (option C in the #816 triage) — still worth revisiting.
4. **Does the replacement round-trip through every path the original participated in?** Cmd+A feeds into clipboard, click-to-clear, Esc-to-clear, type-to-replace. A "select all" that doesn't work in all four paths is half an implementation.
5. **Will a user who never reads docs understand the current state of the UI?** Progressive expansion is only discoverable by pressing Cmd+A a second time. Users who expected one-shot "select all" never reach that moment.

## What We Changed, Concretely

- **Esc now dismisses a non-empty selection** (collapse to head) — satisfying the convention we'd quietly broken.
- **Whole-doc expansion dispatches `AllSelection`**, not `TextSelection(0, docSize)` — eliminates the silent endpoint snap.
- We **did not** ship "first Cmd+A = whole doc" (option C, the most direct fix to the user complaint). We want to see whether A + B alone resolves #816 before giving up the feature. The debt is still there; we've just stopped paying interest on it.

## If You're Here to Add Another "Nice Feature"

The same pattern is easy to repeat. Examples of conventions we still respect that could tempt future over-engineering:

- **Cmd+C / Cmd+V** — copy and paste. Users expect the selection to make the clipboard. Don't silently strip formatting, synthesize new content, or convert types without the user asking.
- **Click-to-collapse selection** — works today because ProseMirror's default handler runs. Any `handleClick` that returns `true` early breaks this silently.
- **Arrow keys move the cursor by one glyph** — our multi-cursor plugin gets this right by being explicit; a naive handler that moves "by word" on arrow key could cause the same class of confusion.
- **Tab moves focus** outside the editor; inside, it indents or escapes bracket pairs. Any change here needs the same scrutiny Cmd+A did not get.

Read `.claude/rules/41-keyboard-shortcuts.md` before touching any of these.
