# SPIKE-P0.3 — Stable element refs across repeated reads within a generation

> Plan: dev-docs/plans/20260715-browser-automation-perception.md (WI-P0.3)
> Governs: ADR-A2 (refs live in the isolated world, invalidated per generation)

## Question

Phase 2 wants `read` to assign every node a ref (`e1`, `e2`, …) that is **stable**
for the life of the committed page, so `act` can target `{ref}` exactly instead of
re-resolving a fuzzy role+name. Two properties must hold:

1. **Stability within a page** — the same element yields the same ref across
   repeated `read`s (the AI reads, thinks, then acts on `e7`, possibly after
   another read).
2. **No leak across a navigation** — a new document tears down the isolated
   content world, so the ref store resets; a ref minted on the old page cannot
   silently resolve to an element on the new one. (Belt-and-suspenders: `act`
   also carries `generation`, so the Rust freshness gate rejects an old ref
   regardless — but the locator layer must not manufacture a false hit either.)

## Probe

`dev-docs/grills/browser-automation/probe-refs.mjs` — a standalone jsdom probe of
the exact mechanism that will run inside `WKContentWorld`: a module-scoped
`WeakMap<Element,string>` + a monotonic counter (the ref store), recreated when
the content world is recreated on navigation. It asserts stability across two
snapshot passes, distinctness, `queryByRef` resolution (including a detached
element no longer resolving), and a fresh store after "navigation".

Run: `node dev-docs/grills/browser-automation/probe-refs.mjs`

## Result (2026-07-15)

```
  PASS refs are assigned in document order (e1,e2,e3)
  PASS each element keeps its ref across repeated reads
  PASS distinct elements get distinct refs
  PASS queryByRef resolves a ref back to its element
  PASS queryByRef returns null for an unknown ref
  PASS queryByRef returns null once the element leaves the document
  PASS a new page's ref store restarts at e1 (counter did not leak)
  PASS a ref minted on the old page does not resolve in the new store
  PASS the old store cannot resolve the new page's element

probe-refs: PASS (all assertions held)
```

- A `WeakMap` keyed by element identity gives stable refs across repeated reads
  for free, and lets a detached element's ref stop resolving (act-on-stale-handle
  is refused at the locator layer, before the Rust gate even runs).
- Recreating the store on navigation (the isolated world is torn down with the
  document) restarts refs at `e1` with no cross-page bleed.

**Proven:** the ref mechanism is stable within a generation and clean across one.
Phase 2 productionizes it in `src/lib/browser/agent/refs.ts` with full unit tests.

## Verdict

**Verdict:** PASS — WeakMap-backed refs are stable within a committed page and do not leak across navigation.
