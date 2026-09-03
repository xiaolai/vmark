/**
 * The platform the app tier is tested AGAINST is macOS — the primary platform
 * (AGENTS.md) — unless a test says otherwise.
 *
 * Without this the value is whatever the host reports: `""` under jsdom,
 * `"Linux x86_64"` under Node on the CI runner, `"MacIntel"` under Node on a
 * maintainer's Mac — so a platform-gated surface (the embedded browser is
 * macOS-only, `browserAccess.ts`) passed its tests locally and could not on CI.
 * Tests for the other platforms override this the way `platform.test.ts` does
 * (`Object.defineProperty(navigator, "platform", …)`); `platform.ts` reads the
 * value at call time. Listed first in `vitest.config.ts` `setupFiles`.
 *
 * @module test/platformDefault
 */
Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true, writable: true });
