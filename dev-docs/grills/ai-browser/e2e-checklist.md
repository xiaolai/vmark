# AI browser Tauri MCP E2E checklist

This checklist is the manual/native gate for the parts unit tests cannot prove. Run it
against a packaged macOS build with the app's debug bridge enabled. Use the Tauri MCP
driver on port `9323`; do not use Chrome DevTools MCP.

## Session and feature gate

1. Start a Tauri driver session with `tauri_driver_session` using `port: 9323`.
2. Confirm `browser.enabled` is off. Send each of `read`, `act`, `open`, `navigate`, and
   `wait`; each returns `BROWSER_DISABLED` and no browser view appears.
3. Enable the browser, create one human tab, and verify it is visible in
   `session.get_state` as `automationMode: human`.

## Store isolation

1. In a human tab, set a test cookie and local-storage value on a disposable fixture
   origin.
2. Use `browser.open` in sandbox posture. Confirm the sandbox tab cannot read either
   human value.
3. Set a sandbox cookie, open a second sandbox tab, and confirm the second tab can read
   the sandbox value.
4. Confirm the human tab cannot read the sandbox value.
5. Disable the feature and verify both AI tabs and their native views disappear.

## Navigation and tickets

1. Open a public fixture URL and record its `navigationId` from the result.
2. Call `wait` with that ticket after load; it returns the buffered terminal result.
3. Start two navigations quickly. The first waiter returns `NAVIGATION_SUPERSEDED`, and
   only the second ticket can return success.
4. Exercise a failing URL and a timeout. Neither result claims `loading: false` success.
5. Try loopback, private-LAN, metadata, alternate-IPv4, userinfo, and unsupported-scheme
   fixtures. Each is rejected before a request starts.

## Shared and human approvals

1. In shared posture, `open` raises destination approval before native navigation.
2. Allow once, verify the committed destination is usable, then redirect the fixture to a
   different origin. The redirect is blocked or produces a fresh approval request.
3. Target a human tab with `read`. The first request raises attachment approval bound to
   the tab and generation.
4. Verify allow-once expires after one successful use; allow-until-navigation expires on
   both full and same-document navigation.
5. Close the window and verify no stale attachment or ticket can be used after reopening.

Record the build identifier, macOS version, test URLs, result payloads with credentials
removed, and any failure as an evidence attachment before marking the phase PASS.
