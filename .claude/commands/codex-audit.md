---
description: Autonomous code auditor running in isolated context - verifies implementation against specs, principles, and quality standards
---

## User Input

```text
$ARGUMENTS
```

## Audit Checklist

Use TodoWrite to track progress through these phases:

```
☐ Reconnaissance: identify scope and structure
☐ Dimension 1: Redundant & Low-Value Code
☐ Dimension 2: Security & Risk Management
☐ Dimension 3: Code Correctness & Reliability
☐ Dimension 4: Compliance & Standards
☐ Dimension 5: Maintainability & Readability
☐ Dimension 6: Performance & Efficiency
☐ Dimension 7: Testing & Validation
☐ Dimension 8: Dependency & Environment Safety
☐ Dimension 9: Documentation & Knowledge Transfer
☐ Generate comprehensive audit report
```

## Delegation Strategy

**Prefer Codex MCP** for per-file analysis when available:
1. Use `ToolSearch` with query `+codex` to discover the Codex MCP tool
2. **Availability test** — send a short ping:
   ```
   mcp__codex__codex with:
     prompt: "Respond with 'ok' if you can read this."
     config: { "model_reasoning_effort": "high" }
   ```
   If Codex does not respond or errors out, skip to **Phase 4: Fallback** immediately. Do not retry.
3. If available, delegate per-file audits to Codex (run SEQUENTIALLY — one at a time)
4. If Codex returns empty, perform the audit manually using Read/Grep

**Model & reasoning**: Do NOT specify a `model` parameter — inherit from global `config.toml` so upgrades propagate automatically. Always pass `config: { "model_reasoning_effort": "high" }` on every Codex call.

**VMark-specific checks** (apply on top of generic dimensions):
- **Zustand**: No store destructuring in components; use selectors or `getState()` in callbacks
- **CSS tokens**: No hardcoded colors — must use design tokens (see `.claude/rules/31-design-tokens.md`)
- **Cross-platform**: Every `Command::new()` audited for Windows/Linux (see `.claude/rules/50-codebase-conventions.md`)
- **File size**: Code files should stay under ~300 lines
- **Plugin structure**: Styles must live in plugin directory only, not in global CSS

### Phase 1: Reconnaissance

Parse `$ARGUMENTS` to determine scope:
| Input | Scope |
|-------|-------|
| (empty) | Uncommitted changes (`git diff HEAD --name-only`) |
| `commit -1` | Last commit (`git diff HEAD~1 --name-only`) |
| `commit -N` | Last N commits (`git diff HEAD~N --name-only`) |
| `--full` | Entire codebase (scan src/, src-tauri/src/) |
| `path/to/dir` | Specific directory/file |

Identify:
- Technology stack (Tauri v2 + React 19 + Zustand v5 + Vite v7)
- Entry points and high-risk areas (auth, IPC, file I/O, MCP bridge)
- Recently changed modules

### Phase 2: Audit All 9 Dimensions

For each code file, analyze across all dimensions:

**Dimension 1: Redundant & Low-Value Code**
- Dead code: unreachable paths, unused functions/imports, commented-out code
- Duplicate code: copy-paste patterns, repeated logic
- Useless code: unused variables, no-op operations, empty catch blocks

**Dimension 2: Security & Risk Management**
- Input validation: command injection, path traversal, XSS via `innerHTML`
- Sensitive data: hard-coded secrets, logged credentials
- IPC safety: unvalidated invoke arguments, missing permission checks

**Dimension 3: Code Correctness & Reliability**
- Logic errors: edge cases, boundary conditions, race conditions
- Runtime risks: null dereference, array bounds, unhandled promises
- Error handling: missing try-catch, swallowed exceptions, `error as Error` casts
- Resource leaks: unclosed listeners, missing cleanup in hooks

**Dimension 4: Compliance & Standards**
- Project rules: AGENTS.md, `.claude/rules/*.md` conventions
- Zustand: no destructuring, `getState()` in callbacks
- CSS: token usage, dark theme parity, focus indicators

**Dimension 5: Maintainability & Readability**
- Complexity: deep nesting, functions >50 lines, files >300 lines
- Magic numbers: hard-coded values not in constants
- Import hygiene: no `../../../` chains, use `@/` alias

**Dimension 6: Performance & Efficiency**
- Unnecessary re-renders: missing memoization, inline object/function props
- Heavy operations: blocking main thread, unbatched state updates

**Dimension 7: Testing & Validation**
- Coverage gaps: critical paths without tests
- Test quality: missing edge cases, no store reset in `beforeEach`

**Dimension 8: Dependency & Environment Safety**
- Vulnerabilities: known CVEs in dependencies
- Config security: secrets in configs, missing .gitignore entries

**Dimension 9: Documentation & Knowledge Transfer**
- Missing docs: undocumented public APIs, outdated comments
- Website sync: user-facing changes missing from `website/guide/`

Report each issue as: `file:line | severity(Critical/High/Medium/Low) | dimension | issue | fix`

Skip non-code files (*.md, *.json, *.css, images) unless specifically requested.

### Phase 3: Compile Report

After all audits complete, compile findings into:

```markdown
# Audit Report

**Date**: {today}
**Scope**: {what was audited}
**Files**: {count}

## Executive Summary

**Overall Risk Score**: Critical / High / Medium / Low

| Dimension | Critical | High | Medium | Low |
|-----------|----------|------|--------|-----|
| 1. Redundant Code | X | X | X | X |
| 2. Security | X | X | X | X |
| 3. Correctness | X | X | X | X |
| 4. Compliance | X | X | X | X |
| 5. Maintainability | X | X | X | X |
| 6. Performance | X | X | X | X |
| 7. Testing | X | X | X | X |
| 8. Dependencies | X | X | X | X |
| 9. Documentation | X | X | X | X |

**Verdict**: PASS / NEEDS WORK / BLOCKED

## Findings by Dimension

### Dimension 1: Redundant & Low-Value Code
| File:Line | Severity | Issue | Fix |
|-----------|----------|-------|-----|
| ... | ... | ... | ... |

[Continue for all 9 dimensions]

## Top Priority Actions

1. **[Critical]** {action} - {file:line}
2. **[High]** {action} - {file:line}

## Positive Observations
- ✅ {good practice found}
```

### Phase 4: Fallback — Manual Audit

**CRITICAL**: If Codex returns empty/no findings, you MUST perform the audit manually.

When Codex returns nothing or incomplete results:

1. **Read each file** using the Read tool
2. **Analyze all 9 dimensions** as described above
3. **Use Grep** to search for common issues:
   ```
   # Dimension 1: Dead code markers
   grep -rn "TODO|FIXME|HACK|XXX|DEPRECATED" src/ src-tauri/src/

   # Dimension 2: Security patterns
   grep -rn "password|api_key|secret|token|eval|innerHTML" src/ src-tauri/src/

   # Dimension 4: VMark violations
   grep -rn "as Error" src/          # Unsafe error casts
   grep -rn "#[0-9a-fA-F]{3,6}" src/**/*.css  # Hardcoded colors
   ```
4. **Report findings** in the same format as Phase 3

**Do NOT say "Codex didn't return findings" and stop. Always complete the audit manually if Codex fails.**
