# WI-0.4 — Empirical check: does force-kill orphan backgrounded children?

> Plan: `dev-docs/plans/20260531-terminal-industrial-best.md`
> Audit finding: L1 (`dev-docs/audit/20260531-terminal-integration.md`, §4 + §8)
> Status: **PENDING — requires a running app. Decides whether Phase 6 runs.**
> Date created: 2026-05-31

## Question

When a terminal tab is force-closed, `pty_kill` (`pty.rs:332`) sends `SIGKILL`
to the **shell** PID only. Dropping the PTY master in `pty_close` then makes the
kernel deliver `SIGHUP` to the terminal's foreground process group. The open
question (audit §8): **do backgrounded / disowned / `setsid` grandchildren
survive as orphans?**

If they survive → Phase 6 (process-group `killpg` + grace) is justified.
If they're reaped → **Phase 6 is aborted** with this finding recorded.

## Repro

1. Run the app; open a terminal tab.
2. In the shell:
   ```bash
   ( sleep 1000 & disown )      # disowned background grandchild
   sleep 1000 &                 # plain background job (still in fg pgroup?)
   nohup sleep 1000 >/dev/null 2>&1 &   # detached
   jobs -l                      # note the PIDs
   ```
3. Force-close the tab (the close button / `pty_kill` path), NOT `exit`.
4. In an external terminal:
   ```bash
   pgrep -fl 'sleep 1000'
   ```
5. Repeat the same for app **quit** (the `Drop` path, `pty.rs:100`).

## Results (2026-05-31, live dev app via Tauri MCP, force `pty_kill` + `pty_close`)

Driven at the transport level (`pty_spawn` → write the markers → `pty_kill` +
`pty_close`), which is the exact force-close path. `pgrep -fl 'sleep 424'`
before and after:

| Scenario | Survived after force-kill? |
|----------|:--------------------------:|
| `sleep 4242 &` (plain background job) | **No** — reaped |
| `sleep 4243 & disown` (disowned) | **Yes** — orphaned |
| `nohup sleep 4244 &` (detached) | **Yes** — orphaned |

The plain background job received `SIGHUP` when the PTY master was dropped, but
the **disowned** and **nohup** jobs survived as orphans. Confirms audit finding
L1 / §8 exactly (foreground reaped; disowned/detached leak).

## Verdict

VERDICT: PHASE 6 ABORTED — the survivors are *intentionally* detached, not a leak.

Initial reading was "orphans confirmed → run Phase 6." On closer analysis that
reverses:

- The **plain `&` job (4242) was reaped** — i.e. ordinary background children
  of the shell already die on force-close. There is **no accidental leak**.
- The only survivors are **`disown`** and **`nohup`** jobs. Surviving the
  shell's death is the *entire documented purpose* of those commands. Every
  reference terminal (VS Code, iTerm2, Terminal.app, WezTerm) lets `nohup` /
  `disown` / `setsid` processes outlive a closed tab — that is the Unix
  contract users rely on.
- A `killpg(pgid, SIGKILL)` that force-killed them would **violate explicit user
  intent and diverge from every standard terminal** — a correctness regression,
  not a fix. The original WI-0.4 criterion ("any detached survivor → run Phase
  6") was wrong: it conflated "survives" with "should be killed".

**Decision:** do NOT implement the process-group force-kill. Current behavior is
correct: non-detached children are reaped; deliberately-detached processes
survive by design.

**Optional future nicety (deferred, not a leak fix):** send the shell `SIGHUP`
with a short grace before `SIGKILL` so it can run EXIT traps / save history /
HUP its own non-disowned jobs gracefully. This respects `disown`/`nohup`
(survivors stay) and is a minor UX polish, tracked in the deferred backlog.
