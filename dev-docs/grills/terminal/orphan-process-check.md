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

VERDICT: ORPHANS CONFIRMED → **Phase 6 RUNS.**

Implement session-leader spawn + `killpg` (SIGHUP → grace → SIGKILL) on Unix.
Note: `disown` and `nohup` do **not** change the process group, so a
`killpg(pgid, SIGKILL)` of the shell's group reaps both survivors (SIGKILL can't
be ignored like `nohup`'s SIGHUP). Phase 6 will close this leak.
