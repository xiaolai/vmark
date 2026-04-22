---
name: react-app-dev
description: Implement or modify VMark React UI with project conventions (Zustand selectors, Tailwind v4, shadcn/ui). Use for components, hooks, stores, and UI behavior changes.
---

# React App Dev (VMark)

## Overview
Apply VMark frontend conventions for React 19 + Zustand v5 + Tailwind v4 + shadcn/ui.

## Workflow
1) Read relevant files before editing (components, hooks, stores, plugins).
2) Follow the VMark rules in `AGENTS.md` (no store destructuring; use selectors).
3) Keep code files under ~300 lines; split when needed.
4) Prefer local feature boundaries; avoid cross-feature imports.
5) Update tests for new behavior and run `pnpm check:all` when asked.

## References
- `references/paths.md` for common source locations and scans.
- Docs map: `dev-docs/README.md`.
