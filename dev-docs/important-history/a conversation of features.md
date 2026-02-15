# Conversation: VMark File History & Auto-Save Strategy

---

## User

Evaluate VMark's file history and auto-save strategy against industry conventions. Compare approaches for handling versioned file snapshots, auto-save intervals, and conflict resolution when the workspace is a Git repository. Recommend an architecture that avoids conflicting with Git while providing robust history recovery and doesn't duplicate version control functionality. Consider UX patterns from VSCode, Sublime Text, and JetBrains IDEs.

---

## Assistant

I'll research VMark's current implementation and industry conventions in parallel.

- **Explore** (Explore VMark file history/auto-save) — *Done (38 tool uses · 116.4k tokens · 1m 28s)*

- **coding-researcher** (Research industry auto-save patterns) — *Done (35 tool uses · 66.7k tokens · 4m 8s)*

### Evaluation: VMark File History & Auto-Save vs. Industry Conventions

Xiaolai, here's a comprehensive analysis of where VMark stands and what could be improved.

---

### Current Architecture Summary

VMark already implements a three-layer model closely mirroring VSCode's industry-leading approach:

| Layer             | VMark Implementation                                                                                                       | Industry Standard (VSCode)                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Hot Exit**      | Session capture/restore via Rust coordinator, stores content + undo history + cursor + UI state in `~/.vmark/session.json` | Debounced dirty-buffer backup to `Backups/` dir                            |
| **Local History** | Full snapshots in `~/.vmark/history/{pathHash}/`, JSON index per file, count + age pruning                                 | Full snapshots in `User/History/{hash}/`, JSON index, count + merge window |
| **Git**           | Not managed — external changes detected via file watcher, user prompted for dirty conflicts                                | Not managed — coexists independently                                       |

This is architecturally sound. VMark correctly separates concerns across the three layers, which is the consensus pattern across VSCode, JetBrains, and Sublime Text.

---

### What VMark Does Well

1. **Three-way conflict tracking** — `content` / `savedContent` / `lastDiskContent` is more sophisticated than most editors. This enables precise dirty detection and external change detection simultaneously.

2. **Content-based pending save matching** — Using content hashes (not timestamps) to distinguish "our save" from "external change" is robust against macOS FSEvents batching delays.

3. **Batched conflict prompts** — The 300ms debounce window for external changes prevents prompt storms during `git checkout` or `git rebase` operations that modify many files.

4. **Hot exit completeness** — Capturing undo/redo history, cursor position (with context), and UI state goes beyond what VSCode preserves.

5. **History snapshot types** — Distinguishing `manual` / `auto` / `revert` snapshots provides useful metadata that VSCode doesn't track.

---

### Gaps and Recommendations

#### Gap 1: No Merge Window (High Priority)

**Problem.** Every auto-save creates a history snapshot. With a 30-second auto-save interval and continuous typing, the history fills with near-identical snapshots that differ by a few characters. At 50 max snapshots, this means the entire history covers only \~25 minutes of work.

**Industry convention.** VSCode uses a 10-second `mergeWindow` — consecutive saves within 10 seconds overwrite the same history entry instead of creating a new one. This is critical when auto-save intervals are short.

**Recommendation.** Add a merge window to `useHistoryOperations.ts`:

```
if (lastSnapshot.type === "auto" AND now - lastSnapshot.timestamp < mergeWindow):
  → Overwrite last snapshot instead of creating new entry
else:
  → Create new snapshot
```

Manual saves should always create a new entry (never merge). A 30-second merge window would pair well with VMark's 30-second default auto-save interval — effectively, auto-save snapshots consolidate until you stop editing, then a new snapshot starts.

#### Gap 2: No Max File Size Guard (Medium Priority)

**Problem.** History snapshots are full file copies. A 5MB Markdown file with embedded base64 images would consume 250MB of history storage at 50 snapshots.

**Industry convention.** VSCode defaults to skipping files > 256KB for local history.

**Recommendation.** Add a `historyMaxFileSize` setting (default: 512KB, since Markdown files tend to be larger than code). Skip snapshot creation for files exceeding the threshold.

#### Gap 3: History Doesn't Survive `~/.vmark/` Deletion (Low Priority)

**Problem.** All history is in `~/.vmark/history/`. If the user cleans up app data, everything is lost.

**Industry convention.** This is actually standard — VSCode, JetBrains, and Sublime all store local history in app data directories. None of them back up history to the workspace. This is intentional: putting history in the workspace would pollute Git repos.

**Recommendation.** No change needed. This is the correct behavior. Document it in user-facing help so users know not to delete `~/.vmark/` casually.

#### Gap 4: No History UI Timeline Integration (Low Priority, UX Enhancement)

**Problem.** History is viewable in a sidebar panel grouped by day, which is functional. But editors like VSCode show Git commits and local history entries interleaved in a Timeline view, making it easy to see the full picture.

**Industry convention.** VSCode's Timeline panel unifies local history and Git commits chronologically with distinct icons.

**Recommendation.** This is a nice-to-have, not a priority. The current sidebar history view is sufficient. If Git integration is ever added, consider a unified timeline then.

#### Gap 5: Auto-Save Could Offer Focus-Change Mode (Low Priority)

**Problem.** VMark only supports interval-based auto-save. VSCode also offers `onFocusChange` (save when switching tabs or windows) and `onWindowChange` (save when switching to another app).

**Industry convention.** JetBrains saves on focus-loss + idle timeout. VSCode offers all three modes.

**Recommendation.** The current interval-based approach is fine for a Markdown editor. Focus-change auto-save is more useful for code editors where you switch between editor and terminal frequently. Not a priority for VMark.

---

### Architecture Comparison Table

| Aspect                        | VMark                               | VSCode                    | JetBrains                    | Sublime                     |
| ----------------------------- | ----------------------------------- | ------------------------- | ---------------------------- | --------------------------- |
| **Auto-save trigger**         | Interval (30s)                      | Delay/Focus/Window        | Idle + Events                | Focus-loss only             |
| **Snapshot format**           | Full file + JSON index              | Full file + JSON index    | Binary changeset blob        | JSON session (full content) |
| **Per-file storage**          | Yes (hashed dir)                    | Yes (hashed dir)          | No (single blob)             | No (single session)         |
| **Retention: count**          | 50                                  | 50                        | N/A                          | N/A                         |
| **Retention: age**            | 7 days                              | None (count only)         | 5 working days               | N/A                         |
| **Merge window**              | None                                | 10 seconds                | N/A (event-based)            | N/A                         |
| **Max file size**             | None                                | 256 KB                    | N/A                          | N/A                         |
| **Hot exit**                  | Full (content + undo + cursor + UI) | Content + basic state     | Full session                 | Full session                |
| **External change detection** | File watcher + content matching     | File watcher + focus-gain | File watcher + focus-gain    | Focus-gain only             |
| **Conflict resolution**       | Prompt (Reload/Keep/Save As)        | Prompt (divergent marker) | Auto-reload + history        | Prompt                      |
| **Git awareness**             | None (works around it)              | Timeline integration      | Local History labels Git ops | Incremental diff target     |

---

### Summary of Recommendations

| Priority   | Change                                           | Effort                                   | Impact                                                                    |
| ---------- | ------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------- |
| **High**   | Add merge window (30s) for auto-save snapshots   | Small — modify `useHistoryOperations.ts` | Prevents history pollution, extends useful coverage from \~25 min to days |
| **Medium** | Add `historyMaxFileSize` setting (512KB default) | Small — guard in snapshot creation       | Prevents storage blowup for large files                                   |
| **Low**    | Focus-change auto-save mode                      | Medium                                   | Nice-to-have, not critical for Markdown                                   |
| **Low**    | Timeline-style unified history + Git view        | Large                                    | UX polish, not functionally needed                                        |

The existing architecture is solid and aligns with industry best practices. The merge window is the most impactful improvement — it's a small change that dramatically improves the usefulness of the history feature. Everything else is incremental polish.

*Brewed for 5m 21s*

---

## User

First devise a plan, implement all, with highest quality.
