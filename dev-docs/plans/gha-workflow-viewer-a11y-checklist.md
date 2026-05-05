# GitHub Actions Workflow Viewer — Manual a11y Checklist

> Phase 9 polish item. Structural a11y (aria-labels, keyboard handlers,
> focus indicators) is delivered in code; this checklist captures the
> manual VoiceOver and keyboard-only flows that need a human pass before
> shipping the feature default-on.
>
> The unit test suite cannot exercise screen-reader narration, focus
> ring rendering, or live keyboard-driven xyflow navigation. Run this
> list against `pnpm tauri dev` with VoiceOver (Cmd+F5) on macOS.

## Setup

1. Open `pnpm tauri dev`.
2. In Settings → Advanced (showDevSection on), enable **Workflow engine**.
3. Open any file under `.github/workflows/` (or any `.yml` file with a workflow shape).
4. Confirm the side panel mounts with the canvas + form panel.

## Keyboard navigation

| Step | Expected |
|------|----------|
| Tab from the source editor into the side panel | Focus moves into the panel chrome (resize handle, then save controls, then diagnostic rows, then forms) |
| Tab to a JobNode in the canvas | Job button receives focus with a U-shaped underline indicator |
| `Enter` (or `Space`) on a focused JobNode | JobForm renders for that job below the canvas |
| `Escape` on a focused JobNode | Selection clears and focus moves back to the source `.cm-content` |
| Tab through JobForm fields | Name → Runs on → Condition → step rows, all reachable, focus visible at each stop |
| Tab into a step row | Row receives focus with a visible ring; `Enter` switches to StepForm |
| Tab through StepForm `with:` rows | Each key/value pair is reachable; remove (×) and add buttons reachable; missing-required chips reachable |
| Tab to Save / Discard | Both reachable; visible focus rings on each |

## Screen reader (VoiceOver)

Turn on VoiceOver (`Cmd+F5`) and use VO (`Ctrl+Option`) navigation.

| Step | Expected narration |
|------|--------------------|
| VO+→ over a JobNode | `"Job <name>. runs on <runner>. <count> steps. depends on <refs>. conditional."` (parts that don't apply are omitted) |
| VO+→ over a "step row" in JobForm | Step name (or `uses:` ref, or synthesized id) + button role |
| VO+→ over a diagnostic row | Severity (warning / error / info) + GHA-* code + message |
| VO+→ over a missing-required chip | Action input key + "required" indicator |
| VO+→ over a save button | Button role + label ("Save" / "Discard") + disabled state if no patches |
| VO+→ over a form input | Field label (Name / Runs on / Condition / Working directory / Run / If) |

## Focus indicators

Per `.claude/rules/33-focus-indicators.md`:

- [ ] JobNode: U-shaped underline below the node body
- [ ] Form text inputs: full-border accent ring + caret remains the primary indicator
- [ ] Save / Discard buttons: U-shaped underline below the button
- [ ] Step rows: full-row accent border + subtle box-shadow
- [ ] Diagnostics rows (clickable variants): accent background tint
- [ ] Missing-required chips: accent border + subtle box-shadow
- [ ] Add-input button: solid border + accent fill on focus
- [ ] Remove (×) button: accent background + error color
- [ ] Diagnostics "show all N" toggle: outline ring (text-button case)

## Dark theme parity

Switch theme in Settings → Appearance → Night.

- [ ] JobNode background follows `--bg-color` (no white-on-dark)
- [ ] React Flow controls (zoom in/out/fit/lock) blend into the panel — no white square
- [ ] Edge strokes use `--border-color` / `--accent-primary`, not the xyflow defaults
- [ ] Form input backgrounds + borders contrast properly with surrounding panel
- [ ] Diagnostic severity icons (✗/⚠/ⓘ) remain readable
- [ ] Save / Discard buttons in clean and dirty states are both legible

## Status — what's verified in code vs what needs a human

**Verified by unit tests + earlier live Tauri-MCP smoke** (no human pass needed):

- aria-label composition on JobNode (4 unit tests)
- Enter / Space activates JobNode (existing test)
- Escape on JobNode clears selection + focuses source (unit test)
- Focus-visible styles defined for all 8 interactive surfaces (gate-checked)
- Dark theme parity: React Flow controls + edges follow tokens (live screenshot diff before/after)
- Light theme parity: same surfaces clean (live screenshot)
- aria-pressed on selected JobNode (existing test)
- aria-modal + aria-label on the ExpressionEditor backdrop dialog
- Save button disabled when no patches; enabled with count when dirty (unit tests)

**Genuinely human-required** (cannot be driven from Tauri MCP):

- VoiceOver narration of every surface (Cmd+F5 + VO+→ across all rows)
- Visual rendering of focus rings at 1× and 2× zoom in both themes
- Keyboard-only Tab order through xyflow canvas (jsdom can't simulate
  the focus-traversal loop xyflow's CSS transforms create)
- Real screen-reader announcements for live region updates (toast,
  diagnostic-banner expansion)

When the four manual items above check out, append a dated entry to the
plan's Status header noting the human a11y pass is complete. After that
the feature is ready to graduate from `advanced.workflowEngine` (default
off) to default-on.
