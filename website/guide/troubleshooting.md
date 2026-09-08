# Troubleshooting

## Quick Lookup

Common issues and where to look for the fix:

| Symptom | Likely cause | Where to look |
|---|---|---|
| MCP client can't connect | Stale port file or VMark not running | [MCP Server Connection Issues](#mcp-server-connection-issues) |
| File won't open or shows garbled text | Non-UTF-8 encoding or quarantine attribute | [File Won't Open](#file-won-t-open) |
| AI Genie hangs or returns nothing | Provider misconfigured or CLI not on PATH | [AI Genie Not Responding](#ai-genie-not-responding) |
| Keyboard shortcut does nothing | Reassigned in Settings or system override | [Keyboard Shortcut Not Working](#keyboard-shortcut-not-working) |
| Slow editor on large files | Per-tab memory + 10K+ line input lag | [Editor Performance](#editor-performance) |
| Menu still in English after language change | Menu rebuilds on launch | [Menu Bar Shows English](#menu-bar-shows-english-after-language-change) |
| PDF export incomplete | Image paths or write permissions | [Export/Print Issues](#export-print-issues) |
| Slow startup on Windows | WebView2 + antivirus scanning | [App Launches Slowly on Windows](#app-launches-slowly-on-windows) |
| `Cmd + R` / `Ctrl + R` does nothing | Reload is blocked by design | [Reload Is Blocked](#reload-is-blocked) |
| Double-clicking a file opened it in the running VMark | Single-instance forwarding on Windows and Linux | [One VMark at a Time on Windows and Linux](#one-vmark-at-a-time-on-windows-and-linux) |
| Blank window on Linux | WebKitGTK DMABUF renderer | [Blank Window on Linux](#blank-window-on-linux) |
| Straight quotes and `--` stay literal on macOS | System smart substitutions are turned off for VMark | [Smart Quotes and Dashes on macOS](#smart-quotes-and-dashes-on-macos) |
| VMark never "naps" in Activity Monitor | App Nap is disabled so AI assistants keep working | [VMark Stays Awake in the Background](#vmark-stays-awake-in-the-background-app-nap) |

For anything not listed above, see [Reporting Bugs](#reporting-bugs).

## Log Files

VMark writes log files to help diagnose issues. Logs include warnings and errors from both the Rust backend and the frontend.

### Log File Locations

| Platform | Path |
|----------|------|
| macOS | `~/Library/Logs/app.vmark/` |
| Windows | `%APPDATA%\app.vmark\logs\` |
| Linux | `~/.local/share/app.vmark/logs/` |

### Log Levels

| Level | What's Logged | Production | Development |
|-------|--------------|------------|-------------|
| Error | Failures, crashes | Yes | Yes |
| Warn | Recoverable issues, fallbacks | Yes | Yes |
| Info | Milestones, state changes | Yes | Yes |
| Debug | Detailed tracing | No | Yes |

### Log Rotation

- Maximum file size: 5 MB
- Rotation: keeps one previous log file
- Old logs are automatically replaced

## Reporting Bugs

When reporting a bug, include:

1. **VMark version** — shown in the navbar badge or About dialog
2. **Operating system** — macOS version, Windows build, or Linux distro
3. **Steps to reproduce** — what you did before the issue occurred
4. **Log file** — attach or paste the relevant log entries

Log entries are timestamped and tagged by module (e.g., `[HotExit]`, `[MCP Bridge]`, `[Export]`), making it easy to find relevant sections.

### Finding Relevant Logs

1. Open the log directory from the table above
2. Open the most recent `.log` file
3. Search for `ERROR` or `WARN` entries near the time the issue occurred
4. Copy the relevant lines and include them in your bug report

## Common Issues

### App Launches Slowly on Windows

VMark is optimized for macOS. On Windows, startup may be slower due to WebView2 initialization. Make sure:

- WebView2 Runtime is up to date
- Antivirus software is not scanning the app data directory in real-time

### Menu Bar Shows English After Language Change

If the menu bar stays in English after switching language in Settings, restart VMark. The menu rebuilds on next launch with the saved language.

### Terminal Doesn't Accept CJK Punctuation

Fixed in v0.6.5+. Update to the latest version.

### MCP Server Connection Issues

The MCP server may fail to start or clients may not connect.

- Ensure VMark is running — the MCP server only starts when the app is open.
- Check that no other process is using the same port. The MCP server writes a port file for client discovery; stale port files from a previous session can cause conflicts. Restart VMark to regenerate it.
- Review the log file for `[MCP Bridge]` entries to identify connection errors.

### Keyboard Shortcut Not Working

A shortcut may appear unresponsive if it conflicts with another binding or has been customized.

- Open Settings (`Mod + ,`) and navigate to the **Shortcuts** tab to check whether the shortcut has been reassigned.
- Look for duplicate bindings — if two actions share the same key combination, only one will fire.
- On macOS, some shortcuts may conflict with system-level bindings (e.g., Mission Control, Spotlight). Check **System Settings > Keyboard > Keyboard Shortcuts**.

### Export/Print Issues

PDF export may hang or produce incomplete output.

- If images are missing in the export, verify that image paths are relative to the document and that the files exist on disk. Absolute URLs and remote images should be accessible.
- Check file permissions on the output directory — VMark needs write access to save the exported file.
- For large documents, export may take longer. Check the log file for `[Export]` entries if it appears stuck.

### File Won't Open

VMark may refuse to open a file or show garbled content.

- Verify the file has read permissions for your user account.
- VMark expects UTF-8 encoded Markdown. Files in other encodings (e.g., GB2312, Shift-JIS) may not display correctly — convert them to UTF-8 first.
- If the file is locked by another process (e.g., a sync client or backup tool), close that process and try again.

### Editor Performance

The editor may slow down with very large files or many open tabs.

- Close unused tabs to free memory — each open tab maintains its own editor state.
- Very large documents (over 10,000 lines) can cause input lag. Consider splitting them into smaller files.
- Disable Focus Mode and Typewriter Mode if not needed, as they add extra rendering overhead.

### AI Genie Not Responding

AI Genies require a configured AI provider to function.

- Open Settings and verify that an AI provider (e.g., Ollama, OpenAI, Anthropic) is configured with a valid model name.
- The provider CLI must be available in your PATH. On macOS, GUI apps have a minimal PATH — if the CLI was installed via Homebrew, ensure your shell profile exports the correct path.
- Check the model name for typos. An incorrect model name will silently fail or return an error.

### Reload Is Blocked

`Cmd + R`, `Ctrl + R` and `Ctrl + Shift + R` do nothing, on purpose. Reloading the webview would throw away every open editor, its undo history and any unsaved state, so VMark blocks the shortcuts, the page-unload path and the webview's own context menu. Two exceptions: `Ctrl + R` reaches the shell when the integrated terminal is focused (reverse-i-search), and `F5` is never blocked because it is the Source Peek shortcut. Development builds only warn about unsaved documents instead.

### One VMark at a Time on Windows and Linux

Double-clicking a file, or launching VMark again from a launcher, hands the file to the VMark that is already running and brings a window forward instead of starting a second copy. A second process would share the first one's app data, session and window storage, and the two would overwrite each other's state — the data loss behind #1330. macOS has always behaved this way through the operating system. A development (`tauri dev`) build uses its own identifier and so counts as a different app.

On Linux this relies on the D-Bus session bus; in a session with no `DBUS_SESSION_BUS_ADDRESS`, VMark may fail to start at all. Launch it from a desktop session, or from a shell where that variable is set.

### Blank Window on Linux

On some AMD / Mesa / WebKitGTK combinations (Arch with KDE Plasma 6 was the reported case, #1058) WebKitGTK's DMABUF renderer fails and the content area stays blank. VMark sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` before the webview starts so this does not happen. If you want the DMABUF renderer back, launch with `WEBKIT_DISABLE_DMABUF_RENDERER=0` — VMark only sets the variable when you have not.

### Smart Quotes and Dashes on macOS

Typing `--` or `"` in VMark stays literal even if your Mac has *Use smart quotes and dashes* turned on. The system would otherwise rewrite text underneath the editor — `-->` in a Mermaid block became `—>` — so VMark turns off the automatic dash, quote and period substitutions for its own process only. Other apps are unaffected, as are input methods and your own text replacements. For typographic quotes inside VMark, use the [CJK formatter's smart-quote rules](/guide/cjk-formatting#smart-quote-styles) or the quote-style toggle (`Shift + Mod + '`).

### VMark Stays Awake in the Background (App Nap)

On macOS, VMark opts out of App Nap for as long as it runs, so Activity Monitor shows it as never napping even when its windows are hidden. App Nap would freeze the webview — and with it every AI-assistant (MCP) request — until you brought a window forward; staying awake is what lets an assistant keep working while you are in another app. The system may still sleep when idle; VMark only asks not to be napped.
