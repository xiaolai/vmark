# Spike A — `@actions/workflow-parser` position coverage

> Status: **PASS** (2026-05-04)
> Plan ADR: ADR-3
> Probe: `probes/spike-a-parser.mjs`
> Run with: `bun spike-a-parser.mjs` (Node 22 needs `--experimental-import-attributes` or a custom loader; see "Runtime caveat" below)

## Goal

Verify that `@actions/workflow-parser` produces a `TemplateToken` AST whose
nodes carry usable `TokenRange` (line/column start + end) for every IR node
the plan's Phase 1 parser needs:

- workflow root
- top-level `on:`
- every `jobs[*]`
- every `jobs[*].steps[*]`
- every `with[*]` value (per step)
- every `strategy.matrix.<dim>` value (per job)

**Pass gate:** ≥95% of these nodes have non-undefined ranges across the
fixture corpus.

## Method

7 fixture workflows from VMark's own `.github/workflows/`:
- `ci.yml` (4 jobs, 16 steps, 1 matrix dim)
- `claude.yml` (4 jobs, 17 steps)
- `release.yml` (3 jobs, 26 steps)
- `deploy-website.yml` (2 jobs, 10 steps)
- `claude-audit.yml` (1 job, 2 steps)
- `claude-cost-report.yml` (1 job, 5 steps)
- `update-homebrew.yml` (1 job, 5 steps)

The probe parses each fixture, walks the AST via `MappingToken.get(i)` and
`SequenceToken.get(i)`, and counts how many tokens at each level have a
non-undefined `range`.

## Findings

### Coverage table

| Fixture | Parsed | Errs | Root | On | Jobs | Steps | With | Matrix |
|---|---|---|---|---|---|---|---|---|
| `claude-audit.yml` | ✓ | 0 | ✓ | ✓ | 1/1 | 2/2 | 5/5 | 0/0 |
| `release.yml` | ✓ | 0 | ✓ | ✓ | 3/3 | 26/26 | 14/14 | 0/0 |
| `deploy-website.yml` | ✓ | 0 | ✓ | ✓ | 2/2 | 10/10 | 4/4 | 0/0 |
| `update-homebrew.yml` | ✓ | 0 | ✓ | ✓ | 1/1 | 5/5 | 3/3 | 0/0 |
| `claude.yml` | ✓ | 0 | ✓ | ✓ | 4/4 | 17/17 | 24/24 | 0/0 |
| `claude-cost-report.yml` | ✓ | 0 | ✓ | ✓ | 1/1 | 5/5 | 1/1 | 0/0 |
| `ci.yml` | ✓ | 0 | ✓ | ✓ | 4/4 | 16/16 | 7/7 | 1/1 |

### Aggregate

| Position class | Coverage |
|---|---|
| Root | 7/7 (100%) |
| `on:` | 7/7 (100%) |
| Jobs | 16/16 (100%) |
| Steps | 81/81 (100%) |
| `with[*]` values | 58/58 (100%) |
| Matrix dims | 1/1 (100%) |
| **Total parser errors** | **0** |

## API summary (for Phase 1 implementation)

```ts
import { parseWorkflow } from "@actions/workflow-parser";

const trace = {
  error: (m) => /* push to diagnostics */,
  info: () => {},
  verbose: () => {},
};

const result = parseWorkflow({ name: "ci.yml", content: yamlString }, trace);
//   ^ TemplateParseResult { context, value: TemplateToken | undefined }

const root = result.value;            // MappingToken
const errors = result.context.errors.getErrors();
//   ^ Array<{ code, message, range }>
```

Walking the tree:

```ts
// MappingToken: count, get(i) → { key, value }
// SequenceToken: count, get(i) → TemplateToken
// Every token: token.range → { start: {line, column}, end: {line, column} }
//              token.line, token.col (convenience getters)
//              token.templateTokenType → TokenType enum
```

### TokenType enum (relevant values, observed)

| TokenType numeric | Name |
|---|---|
| 0 | String |
| 1 | Sequence |
| 2 | Mapping |
| (others) | BasicExpression, Boolean, Null, Number, Scalar, InsertExpression |

The numeric values are stable in the published package; we'll use named
re-exports in our parser orchestrator for readability.

## Runtime caveat (does NOT block plan)

The parser bundles JSON schema files via `import schema from "./workflow-v1.0.min.json"`
without `with { type: "json" }`. Node ≥22 strict ESM rejects this with:

```
ERR_IMPORT_ATTRIBUTE_MISSING: Module ".../workflow-v1.0.min.json" needs
an import attribute of "type: json"
```

**Impact in production (VMark):**
- **Vite** transparently transforms JSON imports — no issue at build time.
- The parser will Just Work in VMark's webview, both dev (`vite`) and prod
  bundles.

**Impact in test/CI:**
- **Vitest** uses Vite's transform — no issue.
- Pure-Node CLI scripts need one of: Bun, `tsx`, or `--experimental-import-attributes`.

**Action:** Phase 1 should add a Vitest test that `parseWorkflow` succeeds
under the project's actual test runner (caught early if a Node version
upgrade ever changes the situation).

## Decision

**Adopt `@actions/workflow-parser` as the Phase 1 read-side parser** per
ADR-3. The fallback path (use `yaml` package for read as well) is **not**
required.

## Open follow-ups for Phase 1

1. Wrap `parseWorkflow` in `parser/index.ts` with a typed `TraceWriter` that
   collects errors into our `Diagnostic[]` shape per §4.4 of the plan.
2. Map `TokenRange` → our `SourceRange` (1-based → keep 1-based; same shape).
3. Build subparsers per IR slice (triggers, jobs, edges, matrix, permissions)
   that walk the `MappingToken`/`SequenceToken` tree.
4. Add a Vitest case proving the parser works in the project's test
   environment (not just Bun).
5. Expand fixture corpus to ≥20 by pulling from public OSS repos before
   Phase 1 acceptance.
