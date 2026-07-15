# AI browser store ownership spike

> Status: **PARTIAL — compile/lifecycle evidence PASS; interactive cookie probe pending**

The implementation keeps `WKWebsiteDataStore` in the macOS-only main-thread
`browser_store_macos.rs` owner. `BrowserSurface` remains `Send` state and contains no
WebKit object. The store is selected before `WKWebView` construction and is cleared when
AI policy disables or changes posture.

Evidence:

- `cargo test --manifest-path src-tauri/Cargo.toml browser::` — 151 passed.
- `pnpm lint:file-size` — passed, including the split store owner.
- A live two-way cookie probe still requires the packaged Tauri app and Tauri MCP session;
  this report deliberately does not claim that native runtime check.
