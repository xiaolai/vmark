## Verdict

Do not land Phase 5 as currently claimed.

The Rust standing-grant exclusion works: I found no route where `eval` is authorized by a standing grant, read-mode rule, shared-origin approval, or human attachment alone. However, “fresh per-call approval” is not approval of the actual script. A generic `eval` one-shot can be spent on a different script, and the human UI never shows the script at all.

Thus the model is:

- “never standing-granted”: enforced.
- “isolated world”: enforced on macOS.
- “result labeled untrusted”: enforced, but advisory.
- “human approves this exact script per call”: not enforced.
- “generation-safe execution”: has a post-authorization race.

No Critical findings. Two High findings block approval.

## Findings

### High — An approval for script A authorizes arbitrary script B

[ browserPower.ts:90 ](/Users/joker/github/xiaolai/myprojects/vmark/src/hooks/mcpBridge/v2/browserPower.ts:90) makes approval depend only on `(URL, operation, target=undefined, tabId)`. Although [browserPower.ts:178](/Users/joker/github/xiaolai/myprojects/vmark/src/hooks/mcpBridge/v2/browserPower.ts:178) puts the first 2,000 script characters into the MCP failure response, it does not put them into `requestApproval`.

The pending approval structure has no script or digest at [browserApprovalStore.ts:28](/Users/joker/github/xiaolai/myprojects/vmark/src/stores/browserApprovalStore.ts:28). The driver one-shot similarly contains only tab, generation, origin, operation, and optional role/name at [one_shot.rs:37](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/one_shot.rs:37).

The UI consequently shows only site and operation at [BrowserApprovalDialog.tsx:116](/Users/joker/github/xiaolai/myprojects/vmark/src/components/Browser/BrowserApprovalDialog.tsx:116), not the script. The sidecar also discards the `script` field when formatting the approval error at [browser.ts:24](/Users/joker/github/xiaolai/myprojects/vmark/vmark-mcp-server/src/tools/browser.ts:24).

Concrete exploit:

1. AI requests harmless A: `return document.title`.
2. User sees only “allow Eval on example.com” and clicks Allow once.
3. AI retries with B: read DOM credentials/storage, submit an authenticated form, call same-origin APIs, or exfiltrate data through a network request.
4. Both frontend and Rust accept B because its tuple is still `(origin, eval, undefined, generation)`.

The existing test even establishes that a different request ID consumes the approval, at [browserPower.test.ts:98](/Users/joker/github/xiaolai/myprojects/vmark/src/hooks/mcpBridge/v2/__tests__/browserPower.test.ts:98); it simply fails to change the script on the retry.

Fix: bind a full-script cryptographic digest and request nonce into `PendingApproval`, `OneShotApproval`, and Rust `OneShot`. Display the exact full script in the human prompt, then recompute and compare the digest immediately before evaluation. A 2,000-character preview is not sufficient because the malicious portion can follow the preview.

### High — Navigation can race authorization and evaluation

`browser_eval` authorizes and then separately dispatches the script at [commands_auth.rs:146](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/commands_auth.rs:146). `surface::eval` subsequently queues work onto the main thread at [surface_macos.rs:256](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/surface_macos.rs:256).

A page navigation clears the committed origin at [nav_delegate_macos.rs:115](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/nav_delegate_macos.rs:115), but that does not invalidate an authorization that already returned successfully. There is no freshness check inside the main-thread closure immediately before `callAsyncJavaScript`, nor after evaluation.

Concrete exploit: an attacker-controlled page repeatedly initiates timed navigation while the approved command is moving from the Rust gate to the main-thread WebKit dispatch. If the new document becomes current before evaluation begins, the arbitrary script can run against a page/generation that was not authorized. Human and sandbox tabs provide the broadest destination opportunity; shared tabs retain their separate navigation restrictions.

Screenshot code already recognizes the same class of race and performs a post-operation freshness check, but a post-check alone is insufficient for eval because script side effects cannot be undone.

Fix: bind evaluation to an exact frame/document identity, perform a main-thread freshness check immediately before dispatch, and include a driver-managed document nonce in the executed wrapper. Runtime-test navigation before dispatch and while an async script is pending.

### Medium — Credential redaction does not remove query-string or fragment secrets

`urlForAgent` removes only URL username/password at [url.ts:78](/Users/joker/github/xiaolai/myprojects/vmark/src/lib/browser/url.ts:78). Query parameters and fragments are preserved.

Both query results and approval errors return that URL to the untrusted AI at [browserPower.ts:58](/Users/joker/github/xiaolai/myprojects/vmark/src/hooks/mcpBridge/v2/browserPower.ts:58) and [browserPower.ts:105](/Users/joker/github/xiaolai/myprojects/vmark/src/hooks/mcpBridge/v2/browserPower.ts:105).

Concrete exploit: a tab at:

```text
https://service.example/callback?access_token=SECRET
```

returns the token unchanged to the AI client. Magic links, signed document URLs, password-reset URLs, and OAuth callbacks commonly carry credentials this way.

Rust authorization logs are safer: they reduce URLs to an origin at [redact.rs:17](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/redact.rs:17).

Fix: use origin-only URLs in approval envelopes and strip or redact query/fragment data in agent-facing metadata unless explicitly required.

### Medium — `style` has the same payload-substitution problem and `injectCss` is not scoped

Style approval is also targetless at [browserPower.ts:149](/Users/joker/github/xiaolai/myprojects/vmark/src/hooks/mcpBridge/v2/browserPower.ts:149). The one-shot does not bind the selector, ref, property values, classes, or CSS.

Concrete exploit: request approval for hiding `.cookie-banner`, then spend the one-shot on an `injectCss` payload that visually spoofs the page or triggers cross-origin CSS resource loads.

The implementation appends raw caller CSS directly to the document at [powerScript.ts:31](/Users/joker/github/xiaolai/myprojects/vmark/src/lib/browser/agent/powerScript.ts:31). Despite the plan and documentation calling it “scoped,” no selector scoping, property allowlist, or rejection of `url()`/`@import` exists. CSS can initiate cross-origin resource requests subject to page CSP and can leak attribute-held data through selector-based CSS exfiltration techniques.

Fix: bind the normalized style payload to one-shot consent. Either remove “scoped” from the contract or actually scope it; consider separating unrestricted `injectCss` from grantable inline style operations.

### Low — The approval UI offers “Remember” for `eval`

The “Allow on this site” button is unconditional at [BrowserApprovalDialog.tsx:154](/Users/joker/github/xiaolai/myprojects/vmark/src/components/Browser/BrowserApprovalDialog.tsx:154).

This does not create an authorization bypass: frontend sanitization removes `eval` at [grants.ts:77](/Users/joker/github/xiaolai/myprojects/vmark/src/lib/browser/approval/grants.ts:77), so clicking Remember silently produces no grant. It is nevertheless misleading security UX and contradicts “remember is not offered.”

Hide the Remember option for `NEVER_GRANTABLE` operations.

## Verified controls

- Rust rejects `eval` standing grants even when `browser_set_grants` contains it: [operation.rs:17](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/operation.rs:17), [origin_guard.rs:218](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/origin_guard.rs:218).
- Mode rules special-case only `read`; every `eval` reaches the one-shot path: [origin_guard.rs:265](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/origin_guard.rs:265), [authorize.rs:122](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/authorize.rs:122).
- Human tabs require both attachment and eval one-shot. Shared-origin approval authorizes only reads; it does not authorize eval.
- Frontend `decideApproval` always returns `needs-approval` for eval: [grants.ts:96](/Users/joker/github/xiaolai/myprojects/vmark/src/lib/browser/approval/grants.ts:96).
- Caller scripts run in `worldWithName("vmark-agent")`, not `pageWorld`: [surface_macos.rs:252](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/surface_macos.rs:252). Apple confirms that content worlds separate JavaScript globals while DOM changes remain shared. [Apple WKContentWorld documentation](https://developer.apple.com/documentation/webkit/wkcontentworld?changes=_8)
- This isolation applies equally to generated and caller-supplied scripts. It blocks page-global access; it does not block DOM, cookie/storage APIs, or ordinary network-capable APIs subject to origin/CSP rules.
- The browsed view uses a fresh raw `WKWebViewConfiguration` with no Tauri message handlers at [surface_macos.rs:101](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/surface_macos.rs:101). The fixed page-world bridge assertion is at [surface_macos.rs:268](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/surface_macos.rs:268).
- Query performs no page-visible DOM mutation. Its only write is isolated-world ref bookkeeping.
- Execute-js results carry `untrusted: true` at [browserPower.ts:189](/Users/joker/github/xiaolai/myprojects/vmark/src/hooks/mcpBridge/v2/browserPower.ts:189), and the sidecar preserves it when serializing the result at [server.ts:181](/Users/joker/github/xiaolai/myprojects/vmark/vmark-mcp-server/src/server.ts:181). I found no automatic act consumer. The marker remains advisory to an untrusted AI client.

## Plan and test gaps

- WI-P5.1: query does not support the planned `{ref}` input or return planned visibility data.
- WI-P5.2: CSS is not scoped and one-shot consent is not payload-bound.
- WI-P5.3: the script is neither displayed nor logged; no script digest is enforced; no checked-in runtime containment test exists.
- WI-P5.5: documentation incorrectly says the approval shows the script and omits the accepted network/exfiltration caveat.
- Missing tests: A→B script substitution, style payload substitution, human/shared eval branches, navigation during eval, query non-mutation, UI script rendering, and actual page-global isolation in a live WKWebView.

This was an inspection audit of commits `34d81519` and `1559c067`; tests were not run.
