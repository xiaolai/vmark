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

## Record results here

| Scenario | Survived after tab close? | Survived after app quit? |
|----------|:-------------------------:|:------------------------:|
| `sleep 1000 &` (plain bg) | _?_ | _?_ |
| `( sleep 1000 & disown )` | _?_ | _?_ |
| `nohup … &` (detached) | _?_ | _?_ |

## Verdict

> _Verdict: PENDING._
>
> - If **any** disowned/detached child survives → Phase 6 RUNS (implement
>   session-leader spawn + `killpg` SIGHUP→grace→SIGKILL on Unix).
> - If **all** are reaped by the master-drop SIGHUP → Phase 6 ABORTED; record
>   "standard behavior confirmed" and move the finding to the deferred backlog.
