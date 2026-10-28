---
paths:
  - "src/**"
  - "src-tauri/src/**"
  - "scripts/**"
  - "server/**"
  - "e2e/**"
---

# 22 - Comment Maintenance

When modifying code in files that have AI-maintenance documentation comments, keep the comments in sync with the code.

## The File Header (enforced: `pnpm lint:file-headers`)

Every production `.ts`/`.tsx` file under `src/` opens with its header. Test, bench and mock files (`.test.`, `.bench.`, `__tests__/`, `__mocks__/`), `.d.ts` files and marked generated files are exempt.

```ts
/**
 * Name — what this file is for, in one or two sentences.
 *
 * Optional sections: Purpose:, Pipeline:, Key decisions:, Known limitations:,
 * @coordinates-with <path> — <why>
 *
 * @module components/Editor/Name
 */

import { … } from "…";
```

- The `/**` block is the file's first bytes: no blank line, `//` line or import before it.
- Its prose says what the file is FOR (five words at least), not just its name. A title line followed by the purpose sentence, `Name — purpose`, and `Purpose: …` are all fine.
- Exactly one `@module` in the file, in the header, naming the file's path under `src/` without the extension. An `index.ts` may name its directory.
- After `*/` comes a blank line or an import / re-export. A block directly above a declaration is that declaration's doc comment, not the file's header.

Rust files carry `//!` module docs. Files with a `Purpose:` line or `//!` docs are the documented files the table below keeps in sync.

## When to Update Comments

| Change Type | Action Required |
|-------------|-----------------|
| Change function behavior | Update its TSDoc / `///` doc |
| Add/remove/rename exports | Add/remove/update their docs |
| Change what a file coordinates with | Update `@coordinates-with` lines |
| Change data flow or pipeline | Update `Pipeline:` in header |
| Change a design decision | Update `Key decisions:` in header |
| Fix a known limitation | Remove it from `Known limitations:` |
| Add a new edge case handler | Add `@edge-case` inline comment |
| Rename a file | Update `@module` path and any `@coordinates-with` references in other files |

## Citations in Comments (enforced: `pnpm lint:provenance-ids`)

A comment says why the code is the way it is, and the reason must be readable from a fresh clone at any later time. In production comments under `src/`, `src-tauri/src/`, `server/`, `e2e/`, `scripts/` and `.claude/hooks/`:

- **No calendar dates.** Keep the fact, drop the when: "measured on <date>: X" becomes "measured: X". A date inside a path or a file name (`.claude/adr/plans/<date>-name.md`) is an identifier and stays, as does an `audit <YYYYMMDD> #N` citation whose record is tracked.
- **No `dev-docs/` document paths.** `dev-docs/` is gitignored, so no clone has the file. Cite a tracked file (`.claude/adr/`, `.claude/tdd-guardian/`) or state the reason in the comment. A path the file's own code reads or writes is its subject and is fine.
- **Work-item and audit ids resolve.** A `WI-…` id stays only when a tracked plan defines it; an audit citation only with the date of a tracked audit record. Otherwise state the behavioural reason and drop the id.
- **A retired plan** is written `Origin: <title> plan (retired) <§ as before>`, with no date.

A citation that wraps across consecutive `//` lines is read as one run, so wrapping does not hide it.

Never reference line numbers or authors in a comment, and never leave a `TODO` without saying concretely what needs doing.
