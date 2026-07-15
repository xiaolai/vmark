# WI-P6.1 — per-use profile-open authorization (H1 fix)

> Design for the blocker the mandatory review found: opening a named persistent
> context must require a per-call user approval, authoritatively enforced in Rust,
> BEFORE the profile is applied — so a malicious AI can't open a guessed profile
> (`github-work`) and read authenticated page content.

## Why the existing one-shot doesn't fit

The `session` one-shot (never-grantable, payload-bound) is close, but it binds
`(tab, generation, COMMITTED origin, op, payload)`. Profile selection happens at
**webview construction**, before any navigation — so there is **no committed origin
and no established tab generation** yet. We can't reuse the committed-origin gate.

## The primitive: a profile-open grant

A new single-use authorization, NOT tab-bound, bound to `(profile, destination
origin)`:

```
ProfileOpen { profile: String, origin_pattern: String }
```

- **Minted** by the frontend when the user approves, in a new
  `BrowserSurface.profile_opens: Mutex<Vec<ProfileOpen>>` (mirrored from the store,
  like grants/one-shots — the driver is the authority).
- **Consumed** atomically inside `browser_ai_create` when a `profile` is requested:
  the destination origin (canonicalised from the validated `url` the command is
  loading) plus the profile must match a stored grant, or the profile is refused.
- Single-use: an approval authorizes exactly one open. Re-opening the same profile
  needs a fresh approval (per-USE, per the review).

## Flow

1. AI calls `open(url, profile)`.
2. Frontend `handleBrowserOpen`: if `profile` is set, `consumeProfileOpen(url,
   profile)`. On miss → `requestProfileOpen(id, url, profile)` raises an approval
   ("Allow the AI to open profile `github-work` on `https://github.com`?") and
   responds `needsApproval` — the tab is NOT created.
3. On "Allow once" the store mints a `ProfileOpen{profile, origin}`; `grantSync`
   pushes it to the driver (`browser_add_profile_open`).
4. AI retries `open(url, profile)`; `consumeProfileOpen` now succeeds; the tab is
   created and `browser_ai_create` runs.
5. `browser_ai_create`, seeing `profile.is_some()`, **authoritatively** consumes a
   matching `ProfileOpen` (destination origin from `url`, exact profile) BEFORE
   `surface::create_with_mode` applies the profile. No grant → `PROFILE_NOT_APPROVED`,
   and the profile is never applied (the tab either fails or — safer — is refused).

The approval is **never grantable** (no "allow on this site") and single-use, exactly
like `session`. Escape/Enter deny.

## The other findings, folded in

- **H2** (pre-14 isolation): `browser_store::configure` gives each named profile its
  OWN store — `dataStoreForIdentifier:` on macOS 14+, else a SEPARATE
  `nonPersistentDataStore` per name (isolated, just not persistent). NEVER the shared
  singleton.
- **Medium (validation):** a Rust `validate_profile()` (ASCII `[A-Za-z0-9._-]`,
  1..=64) rejects an untrusted name at `browser_ai_create` — not only the frontend.
- **Medium (removal):** the UI "Remove profile" calls a native
  `browser_forget_profile(profile)` → `removeDataStoreForIdentifier:` so on-disk data
  is actually revoked, not just the registry row.
- **Medium (unbounded):** the authoritative driver caps distinct profile-opens /
  named stores (a bounded map); beyond the cap, refuse rather than grow without limit.
- **Low (UUID):** unchanged (122-bit is fine for non-adversarial names); documented.

## Test surface

- Rust: `consume_profile_open` matches exact (profile, origin), refuses a different
  profile / origin, is single-use; `browser_ai_create` refuses a profile with no
  grant; `validate_profile` rejects bad names; the pre-14 fallback yields a distinct
  store per profile.
- Frontend: `handleBrowserOpen` refuses profile-open without approval, retries after
  it, and an approval for profile A can't open profile B.
- Live-E2E (macOS 14+): A→A persists; A≠B isolated; named≠unnamed; named≠Human.
