# Windows code-block execution

Clicking Run on a Windows PowerShell, CMD or Python fence executes it once in
VMark's existing integrated terminal panel. Unix fences keep paste-only behavior.

- [x] WI-WCR1: Add regression tests for Windows fence aliases, explicit-click
  dispatch, multiline/Unicode source, working directories and spawn failure.
- [x] WI-WCR2: Reuse the current internal PTY with a matching interpreter,
  creating one only when none is live. Retain output and clean scripts from
  reused runs after execution; retain PTY teardown cleanup as a fallback.
- [x] WI-WCR3: Support PowerShell/ps1, CMD/bat/batch/dos and Python/py/python3.
  Prefer the document-local Python .venv, then py -3 or system Python.
- [ ] WI-WCR4: Validate the upstream integration and record exact results and
  remaining limits in the PR, including frontend, Rust and repository gates.

The original implementation was tested on v0.9.92 with native interpreter
integration tests and real Run-button clicks for all three languages. Its UI
checks covered document preservation, a local .venv and no execution on restart.
Those historical checks do not establish acceptance on the new upstream base.
The PR integrates with v0.9.116 and preserves its PTY input queue and terminal
changes. The existing Run button, panel and layout are reused.

Terminal reuse is also covered by current-session, session-limit, startup-race
and failure regressions. The v0.9.92 local build passed six real Run-button
clicks across PowerShell, CMD and Python without adding a tab, including a
hidden panel and a restart without re-execution. This remains historical
evidence until native/UI acceptance is repeated on this PR base.
