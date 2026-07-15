# AI browser security limitations

- The SSRF policy checks request URLs and the URL WebKit reports at top-level commit.
  WebKit owns DNS resolution, so DNS rebinding remains a residual risk when a public
  hostname resolves to a private address without changing the committed URL. VMark does
  not claim complete SSRF prevention.
- macOS `WKWebView` is the only native implementation in this plan. Windows and Linux
  return `UNSUPPORTED_PLATFORM` from the explicit stubs.
- Same-document navigation is observed through URL KVO. A page can still rewrite DOM
  content without changing its URL; generation-bound one-shots and exact ARIA target
  binding limit, but cannot eliminate, that ambiguity.
- AI tabs and all AI approvals are transient. Restarting VMark does not restore AI
  cookies, tabs, grants, one-shots, or human-tab attachments.
- Navigation responses redact credentials and query-bearing URLs at the MCP boundary;
  page snapshots are not logged by the browser security path.
