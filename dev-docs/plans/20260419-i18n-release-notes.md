# VMark i18n Release Notes — 2026-04-19

Suggested paragraph for the next release's GitHub Release page and the website changelog:

---

## International Edition, already yours

VMark now ships in **10 languages** out of the box — English, 简体中文, 繁體中文, 日本語, 한국어, Deutsch, Español, Français, Italiano, and Português (Brasil). The language matches your OS on first launch and can be changed any time from **Settings → Language**.

Under the hood:

- **OS detection on first launch** — new installs read `navigator.language` / `navigator.languages` with a fallback chain (Simplified-Chinese variants → zh-CN; Traditional-Chinese variants → zh-TW; all Portuguese → pt-BR; base-language fallback for fr/de/es/it). Existing users keep their current choice.
- **Error messages now translate too** — Pandoc export failures, PDF export errors, workflow validation, hot-exit issues, and path/size guards all speak your language. 41 new error keys across all 10 locales.
- **App strings fully swept** — 14 remaining hardcoded English strings in the React frontend migrated to `t()` (toasts, dialogs, fallback labels, aria-labels).
- **Translation workflow formalized** — the `translate-docs` skill now has an App string mode that syncs new keys across all 10 locales with audit, cultural polish, and placeholder preservation.

No English leaks into a non-English session on any user-facing path we could find. If you spot one, [open an issue](https://github.com/xiaolai/vmark/issues).

---

## Release checklist for the version bump

- [ ] Bump all 5 version files per `.claude/rules/40-version-bump.md`
- [ ] Tag `v0.6.47` (or whichever version)
- [ ] Include the paragraph above in the GitHub Release
- [ ] Verify the website shows the new "Speaks Your Language" card on all 10 locale home pages
- [ ] Announce on: project README, `vmark.app` home, GitHub Discussions (if the project uses them)
