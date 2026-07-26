# Workspace Rail Legibility (#1145)

**Status:** Phase 1 — complete (verified live)
**Issue:** [#1145](https://github.com/xiaolai/vmark/issues/1145)

## Problem

The rail spends its 30px on the least informative signal available.

`WorkspaceRail.tsx` renders a 14px `Folder` icon plus a badge containing
`index + 1`. That number is **positional**: it changes on reorder, so it
identifies nothing stable, and position is already visible from the layout. The
workspace *name* — the only thing that identifies it — is hidden in a `title`
tooltip. A stable identity signal does exist (`workspaceRailColorForSeed` hashes
`rootId`) but it is used as a faint tint and `hash % 6` collides readily.

Two further defects found while reading the code:

- **Active state is signalled by colour alone** (`aria-pressed="true"` sets only
  `color:` and the badge background). Rule 33 rejects colour-only signalling for
  focus; the same reasoning applies to selection.
- **`.workspace-rail__index` and `.workspace-rail__duplicate` both sit at
  `right:-3px; bottom:-3px`** — they overlap, so hovering an entry covers the
  number with the duplicate button.

## Decision

Show **identity instead of position** in the space that already exists.

Replace the folder-icon-plus-number with a **glyph derived from the workspace
name** (`A-SCHOOL-YARD` → `A`), the pattern Slack and VS Code profiles use. This:

- puts a stable, identity-bearing signal in the same 30px;
- removes the badge, which resolves the overlap (F5) for free;
- distinguishes workspaces (letter) from Loose Files (`FileStack` icon) without
  a divider — ordering is user-controlled by drag, so a positional divider would
  wander. This subsumes the "separate Loose Files" item.

**Explicitly not doing:** the three-mode setting (Off / Left rail / Top tabs)
from the issue. A top tab strip drags in atomic workbench switching — terminal
sessions are window-global today — which is the expensive part, and it does not
serve the reporter's stated pains ("names hidden until hover", "active workspace
less readable"). Both are solved here without touching switching semantics.
Deferred, with reasoning recorded on the issue.

## Work items

| WI | Change | Files |
|---|---|---|
| WI-1.1 | `workspaceRailGlyphs()` — pure fn, shortest unique prefix per instance | `src/utils/workspaceIdentity.ts` (+ test) |
| WI-1.2 | Render the glyph instead of `Folder` + index badge | `WorkspaceRail.tsx` |
| WI-1.3 | Active state gains a shape cue (not colour alone) | `WorkspaceRail.css` |
| WI-1.4 | Update the characterization test that pins `["1","2"]` | `WorkspaceRail.test.tsx` |

## Failure modes

Each is covered by a test unless marked otherwise.

| # | Failure mode | Mitigation |
|---|---|---|
| F1 | The existing test `renders numbered folder indicators with stable workspace colors` pins `["1","2"]` and `.workspace-rail__folder svg`. Silently deleting it would drop coverage of the colour seeding it also asserts. | Rewrite it to assert glyphs, and KEEP its colour assertions. |
| F2 | Name edge cases: empty, whitespace-only, CJK, emoji (surrogate pairs), leading dot (`.config`), very long. | `Array.from()` for code-point safety; unit tests per case; fallback glyph when no usable character. |
| F3 | Two workspaces share an initial (`alpha`, `apex`) → identical glyphs, identity lost again. | Shortest **unique** prefix: extend to 2+ chars only for colliding names. |
| F4 | Loose Files has no meaningful root name; giving it a letter would misrepresent it as a workspace. | `kind === "loose"` keeps the `FileStack` icon; glyph logic never applies. |
| F5 | Index badge and duplicate button overlap at the same corner. | Removing the badge resolves it. Assert the duplicate button still renders. |
| F6 | Active state unreadable for colour-blind users / low contrast in dark theme. | Add a shape cue (left indicator bar) + `--accent-bg`; tokens only, so dark theme follows. |
| F7 | Screen readers read the glyph ("A") instead of the workspace name. | Glyph is `aria-hidden`; the button keeps `aria-label={t("workspaceRail.activate", {name})}` with the FULL name. Assert the accessible name is unchanged. |
| F8 | A 2-char glyph overflows the 30px rail. | Constrain with tokens; assert the rail width constant is unchanged by the existing width test. |
| F9 | New CSS trips a gate — undefined var, hardcoded colour, or a new `*-btn` class breaking the bespoke-button ratchet. | Tokens only; no new button classes; `pnpm check:all` before commit. |
| F10 | Reorder changes glyphs (the exact defect being fixed). | Glyph derives from name, never index — test that reordering leaves glyphs unchanged. |
| F11 | i18n: a new user-facing string would need 9 locales. | No new strings — the glyph is derived from existing data; `aria-label` reuses the existing key. |

## Definition of done

- `pnpm check:all` green (includes the token, shell-slot and bespoke-button gates).
- Glyphs stable across reorder; unique among open instances.
- Accessible names unchanged (full workspace name, not the glyph).
- Loose Files still renders its icon and no glyph.

## Outcome

`pnpm check:all` exit 0 — 24,315 tests (+16). Verified in the running app with
two workspaces whose names collide (`alpha`, `apex`) plus Loose Files:

| Check | Result |
|---|---|
| Collision handling (F3) | glyphs `AL` / `AP` — shortest unique prefix |
| Accessible name (F7) | `Activate alpha` — full name, glyph is `aria-hidden` |
| Active background (F6) | active `rgba(0,102,204,0.1)` (`--accent-bg`), inactive transparent |
| Active shape cue (F6) | active `::before` renders a 2px bar in the workspace colour; inactive `content: none` |
| Loose Files (F4) | keeps `FileStack`, no glyph |

Two failure modes fired during implementation and were handled rather than
worked around:

- **F2 was under-specified.** The first `glyphSource` skipped leading characters
  until a letter or digit, which also skipped emoji — `🚀rocket` yielded `R`. An
  emoji is a legitimate identity glyph, so the rule now skips punctuation and
  separators only (`\p{P}\p{Z}\p{C}`), keeping `.config` → `C` while preserving
  `🚀`.
- **F9 fired via the file-size gate**, not a token gate: `workspaceIdentity.ts`
  reached 367 lines. Per rule 00 the baseline ratchets down only, so the glyph
  logic was split into `utils/workspaceRailGlyphs.ts` (+ its own test file)
  rather than baselined. `workspaceIdentity.ts` returned to byte-identical.

## Deferred

Items from the original UX assessment not in this phase:

- **Context menu (Close / Duplicate / Move to new window).** There is still no
  way to close a workspace from the rail, and move-out is only reachable by
  dragging an entry outside the viewport — undiscoverable and easy to trigger
  by accident. This is a real missing capability, larger than the legibility
  work, and wants its own phase.
- **Distinct colours among OPEN instances.** `hash % 6` still collides; the
  shape cue now carries the active signal regardless, so this is cosmetic.
- **Top tab strip (the issue's literal ask).** Deferred with reasoning above.
