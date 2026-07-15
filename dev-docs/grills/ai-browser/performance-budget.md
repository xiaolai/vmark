# AI browser performance and resource budget

These are guardrails for the first implementation. A timeout or budget failure is a
diagnostic result, not permission to increase limits silently.

| Resource | Budget | Enforcement/evidence |
| --- | ---: | --- |
| `browser.wait` timeout | 1–12,000 ms | Sidecar and frontend integer validation |
| Terminal broker history | 8 tickets per tab | `BrowserEventBroker.maxTerminalsPerTab` |
| Native create/eval main-thread wait | 20 s / 5 s | Existing `on_main` and JS driver caps |
| AI sandbox store owners | 1 per app lifetime | Main-thread thread-local owner |
| Browser event listeners | 3 process listeners | Broker `start`/`stop` lifecycle |
| AI tabs restored at startup | 0 | Persistence drops `transient-ai` tabs |
| Approval persistence | 0 | Grants, one-shots, and attachments are memory-only |

Measure open, navigate, and wait latency over ten runs in the packaged app. Capture
active webview count before/after disable, broker terminal count after 100 superseded
navigations, and memory after opening two sandbox tabs. A regression is actionable when
it exceeds the stated budget or leaves a native view, waiter, ticket, or approval behind.
