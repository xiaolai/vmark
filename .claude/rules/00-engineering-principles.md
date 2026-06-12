# 00 - Engineering Principles (Local)

Follow the shared rules in `AGENTS.md`.
This file exists to mirror local-only references from dev docs.

Key points:
- Read before editing; keep diffs focused.
- No Zustand store destructuring in components.
- Prefer `useXStore.getState()` inside callbacks.
- Keep features local; avoid cross-feature imports unless shared.
- Keep code files under ~300 lines. Enforced by `scripts/check-file-size.mjs`
  (`pnpm lint:file-size`, in `check:all`): it fails on any NEW file over the
  limit or growth of a baselined file. `scripts/file-size-baseline.json` freezes
  the 153 pre-existing violators — the gate ratchets down only, so split a file
  and lower/remove its baseline number; never raise one.
