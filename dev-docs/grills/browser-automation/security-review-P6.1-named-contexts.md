# Verdict

**WI-P6.1 is not safe to land yet.** The macOS 14+ WebKit store primitive is wired correctly, but there are two High-severity security failures: named identities require no user approval, and macOS 10.15–13 collapses every named context into the same sandbox store.

No Critical findings.

## Findings

### High — Named identities can be opened without user consent

ADR-A7 explicitly requires a fresh, non-grantable `session` approval before opening an authenticated named context ([plan:285](/Users/joker/github/xiaolai/myprojects/vmark/dev-docs/plans/20260715-browser-automation-perception.md:285)).

The implementation instead:

- Accepts and forwards the profile directly ([browserNavigation.ts:115](/Users/joker/github/xiaolai/myprojects/vmark/src/hooks/mcpBridge/v2/browserNavigation.ts:115)).
- Performs only browser-enabled and URL checks in Rust ([ai_commands.rs:101](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/ai_commands.rs:101)).
- Applies the profile without an authorization check ([ai_commands.rs:157](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/ai_commands.rs:157)).
- Automatically permits reads of any committed `AiSandbox` page ([origin_guard.rs:277](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/origin_guard.rs:277)).

**Exploit:** A malicious AI guesses a predictable profile such as `github-work`, opens an account page under that profile, and immediately reads private authenticated page content. Mutating operations remain separately gated, but confidentiality is already lost.

**Fix:** Treat `open(profile)` as a never-grantable `session` operation, bound to at least `(profile, destination origin)`, with an authoritative Rust one-shot check. Ideally, permit only profiles explicitly created/selected by the user.

### High — macOS 10.15–13 loses all cross-profile isolation

On unsupported systems, every named profile falls through to the singleton `AI_SANDBOX_STORE` ([browser_store_macos.rs:71](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/browser_store_macos.rs:71), [browser_store_macos.rs:86](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/browser_store_macos.rs:86)). That singleton is also used by unnamed sandbox tabs ([browser_store_macos.rs:89](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/browser_store_macos.rs:89)).

**Exploit:** On macOS 13, a user logs into profile `work`. An AI opens profile `personal` — or omits the profile — and receives the same in-memory cookies and local storage.

This is not merely “the login will not persist.” It is a collapse of the security boundary, and the caller receives no indication that the requested profile was not applied.

The availability guard itself is correct: the 14+ selector is reachable only after the major-version check ([browser_store_macos.rs:30](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/browser_store_macos.rs:30)). Apple introduced identifier stores on macOS 14, so the selector should not run below that version. [WebKit’s profile API documentation](https://webkit.org/blog/14423/building-profiles-with-new-webkit-api/)

**Fix:** Either maintain a separate nonpersistent store per profile below macOS 14, or reject named profiles with an explicit `NAMED_PROFILES_UNSUPPORTED` error. Never collapse them into the unnamed singleton.

### Medium — Persistent profile creation is unbounded and removal does not revoke it

Every new valid name creates and permanently retains another store entry ([browser_store_macos.rs:25](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/browser_store_macos.rs:25), [browser_store_macos.rs:74](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/browser_store_macos.rs:74)). WebKit creates a persistent store when an identifier does not exist. [Apple documentation](https://developer.apple.com/documentation/webkit/wkwebsitedatastore/init%28foridentifier%3A%29)

There is no maximum profile count, creation rate limit, disk quota, authoritative profile registry, or native deletion path.

Additionally, the current “Remove” UI deletes only transient Zustand metadata ([BrowserSessionsList.tsx:71](/Users/joker/github/xiaolai/myprojects/vmark/src/components/Browser/BrowserSessionsList.tsx:71)); its own comment acknowledges that on-disk data remains ([BrowserSessionsList.tsx:13](/Users/joker/github/xiaolai/myprojects/vmark/src/components/Browser/BrowserSessionsList.tsx:13)). The registry is not persisted across app restarts ([browserSessionStore.ts:46](/Users/joker/github/xiaolai/myprojects/vmark/src/stores/browserSessionStore.ts:46)).

**Exploits:**

- An AI repeatedly opens `p000001`, `p000002`, and so on, producing persistent WebKit stores and retained objects. A hostile page can amplify disk use with caches and origin storage.
- A user clicks “Remove profile,” but the AI later opens the same name and retrieves the supposedly removed authenticated store.

**Fix:** Profiles should be user-created, capped, persisted in an authoritative registry, and deleted through `removeDataStoreForIdentifier`. “Remove” must not be exposed until it revokes the actual store.

### Medium — Rust does not validate the untrusted profile boundary

The Tauri command accepts an unrestricted `Option<String>` ([ai_commands.rs:91](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/ai_commands.rs:91)). Native configuration checks only that it is nonempty ([browser_store_macos.rs:71](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/browser_store_macos.rs:71)).

The sidecar and frontend apply the regex, but invalid values are silently converted to `undefined` rather than rejected ([browser.ts:281](/Users/joker/github/xiaolai/myprojects/vmark/vmark-mcp-server/src/tools/browser.ts:281), [browserNavigation.ts:116](/Users/joker/github/xiaolai/myprojects/vmark/src/hooks/mcpBridge/v2/browserNavigation.ts:116)).

The browsed WKWebView has no Tauri bridge, which limits direct page exploitation. Nevertheless, a compromised document renderer or any future native caller can invoke the registered command with Unicode, control characters, or an arbitrarily large string. There is no path injection because the name is hashed, but memory/CPU amplification and policy inconsistency remain.

**Fix:** Add one Rust `validate_profile()` enforcing ASCII, 1–64 bytes, and the exact character set. Reject invalid input at every outer layer rather than silently opening the unnamed sandbox.

### Low — UUID isolation has 122-bit output, not collision-proof separation

Six digest bits are overwritten by UUID version/variant fields ([browser_store_macos.rs:45](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/browser_store_macos.rs:45)), leaving 122 effective bits.

For two ordinary distinct names, collision probability is negligible. A generic attacker-chosen pair costs roughly \(2^{61}\) SHA-256 evaluations; targeting an existing profile costs roughly \(2^{122}\). This is not a practical exploit in the normal profile model, but absolute isolation should ideally use random UUIDs stored in an authoritative registry or detect duplicate UUID bindings.

## Verified properties

- **macOS 14+ store mechanics:** Correct. Same name produces the same deterministic UUID and hits the same map entry; different ordinary names produce distinct UUIDs and identifier stores.
- **Human/default isolation:** Correct statically. Human creation hardcodes `Human, None` ([surface_create_macos.rs:16](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/surface_create_macos.rs:16)); `Human` and `AiShared` return before named-store selection ([browser_store_macos.rs:68](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/browser_store_macos.rs:68)). WebKit’s default and nonpersistent stores do not have profile identifiers.
- **Shared-sandbox isolation on macOS 14+:** Correct. Named profiles use the identifier store; unnamed sandbox tabs use the nonpersistent singleton.
- **Clear lifecycle:** `clear_ai_sandbox_store()` calls only `browser_store::clear()` ([surface_macos.rs:79](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/surface_macos.rs:79)), and `clear()` drops only the unnamed sandbox handle ([browser_store_macos.rs:100](/Users/joker/github/xiaolai/myprojects/vmark/src-tauri/src/browser/browser_store_macos.rs:100)). Later Human/AiShared tabs cannot accidentally inherit a named store.
- **Direct credential logging:** None found. This feature never enumerates store contents and contains no profile-content logging.

The “AI never receives credentials” statement still needs qualification: approved arbitrary `execute_js` returns its result to the AI ([browserPower.ts:190](/Users/joker/github/xiaolai/myprojects/vmark/src/hooks/mcpBridge/v2/browserPower.ts:190)), and the test suite explicitly treats `document.cookie` as a possible requested script ([browserPower.test.ts:149](/Users/joker/github/xiaolai/myprojects/vmark/src/hooks/mcpBridge/v2/__tests__/browserPower.test.ts:149)). HttpOnly cookies remain protected, but JS-readable cookies/local-storage tokens can cross after explicit per-call approval.

## Test coverage gaps

WI-P6.1 has effectively no feature tests:

- The frontend test checks only that an absent profile forwards `undefined` ([browserNavigation.test.ts:85](/Users/joker/github/xiaolai/myprojects/vmark/src/hooks/mcpBridge/v2/__tests__/browserNavigation.test.ts:85)).
- The sidecar open test does not exercise profiles ([browser.test.ts:225](/Users/joker/github/xiaolai/myprojects/vmark/vmark-mcp-server/__tests__/unit/tools/browser.test.ts:225)).
- There is no Rust test for validation, mode gating, UUID stability/distinctness, cache reuse, or fallback behavior.
- The Phase 6 gate explicitly excludes WI-P6.1 ([check-browser-automation-phase.sh:264](/Users/joker/github/xiaolai/myprojects/vmark/scripts/check-browser-automation-phase.sh:264)), despite the plan requiring isolation tests.

Required before landing: approval/refusal tests, Rust boundary tests, pre-14 fallback tests, profile-limit/deletion tests, and the planned macOS 14+ live E2E matrix covering A→A persistence, A≠B isolation, named≠unnamed, named≠Human, and clear behavior.

The live E2E verification will validate WebKit behavior, but it cannot repair the static authorization and pre-14 isolation failures above.
