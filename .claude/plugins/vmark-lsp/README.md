# vmark-lsp

Language servers for the file types VMark actually contains that **no marketplace
serves** — YAML, CSS and JSON.

TypeScript and Rust are already covered by `typescript-lsp` and
`rust-analyzer-lsp` from `claude-plugins-official`; both are listed in
`.claude/settings.json` under `enabledPlugins`. This plugin exists only for the
gap, which was measured rather than assumed:

| Type | Files | Lines | Served by a marketplace? |
|---|---:|---:|---|
| `.ts` + `.tsx` | 3,128 | 619,243 | yes — `typescript-lsp` |
| `.rs` | 448 | 88,981 | yes — `rust-analyzer-lsp` |
| `.md` | 633 | 114,717 | no (see "Not included") |
| `.json` | 197 | 46,098 | **no → here** |
| `.css` | 136 | 20,166 | **no → here** |
| `.yml` | 52 | 15,718 | **no → here** |

## Why these three, and what they buy

**YAML — the highest-value one.** 12 of the 52 files are `.github/workflows/*`,
and the SchemaStore GitHub Actions schema turns a misspelled key or a wrong type
into an edit-time error instead of a CI round trip. The other 10 are
`src-tauri/locales/*.yml`, the i18n bundles.

Be clear about its limit: schema validation checks **shape, not semantics**. It
would NOT have caught the `>-` folded-scalar bug that broke `BYTE_IDENTICAL` in
`ci.yml` — that was valid YAML whose meaning changed. Nothing here replaces
reading the diff.

**CSS.** `unknownProperties` is set to `error` because VMark's CSS is
token-driven and a typo'd property is silently inert. `unknownAtRules` is
deliberately `ignore`: Tailwind's `@apply`/`@theme` are not in the CSS spec and
would otherwise produce constant false errors.

**JSON.** Beyond the stock schemas, this wires hand-written schemas for the two
ratchet baselines whose shape was verified against the real files:
`command-error-baseline.json` and `file-size-baseline.json`. Both use
`additionalProperties: false`, so a typo'd key (`fils` for `files`) is caught at
the keystroke rather than by a gate that silently reads zero violations.

The other six `scripts/*-baseline.json` files are deliberately **not** covered:
they have genuinely different shapes (`entries`, `units`, `surfaces`,
`exports`, …). One schema over `scripts/*-baseline.json` would have matched none
of them properly while looking like it validated all eight.

## Install (each developer, once)

The plugin declares the servers; it does not ship them. Install the binaries:

```bash
# YAML — Red Hat, actively maintained
npm i -g yaml-language-server

# CSS + JSON — Microsoft's servers, extracted. Pick ONE:
npm i -g vscode-langservers-extracted             # canonical, last published 2024-05
npm i -g @t1ckbase/vscode-langservers-extracted   # fork, current, auto-tracks upstream
```

Both packages provide the same binary names (`vscode-css-language-server`,
`vscode-json-language-server`), so this plugin works with either — the choice is
yours and needs no config change.

Verify they are on the PATH Claude Code uses, not just your interactive shell:

```bash
env -i PATH="$PATH" sh -c 'command -v yaml-language-server vscode-css-language-server vscode-json-language-server'
```

A version-pinned path (`~/.local/share/mise/installs/node/<version>/bin`) works
until the runtime is upgraded and then fails silently — no error, just no code
intelligence. Prefer a shim directory that survives version changes.

Then register this repo as a local marketplace and enable the plugin:

```bash
claude plugin marketplace add ./.claude/plugins
claude plugin install vmark-lsp@vmark-local --scope project
```

`--scope project` writes to `enabledPlugins` in `.claude/settings.json`, so the
plugin is enabled for everyone who clones. Restart Claude Code — plugin and LSP
config are read at startup.

## Why this can't just live in `.claude/settings.json`

It cannot, by design. Claude Code ignores `pluginConfigs` from a project's
settings file precisely because a cloned repository could otherwise supply LSP
commands that execute locally. Registering a marketplace stays a deliberate act
by the person running the session. `enabledPlugins` is still honoured from
project settings, which is why the entry above works once you have opted in.

## Not included, and why

- **Markdown.** `marksman` is the usual choice but has been quiet upstream since
  2026-02 and is deprecated in Homebrew. VMark also already has
  `lib/markdownLinkCheck` and a lint engine covering the same ground.
- **Vue.** The only option is a community plugin with one star and a single day
  of activity. All 16 `.vue` files are in `website/.vitepress/` — 0.4% of the
  repo — which does not justify running a third party's server in the session.

## Verified before shipping

The config was checked against the real repository rather than assumed correct:

- All **12** `.github/workflows/*.yml` validate against the wired SchemaStore
  schema. The first attempt reported all 12 as *invalid* — that was the test
  harness, not the workflows: PyYAML is YAML 1.1, where a bare `on:` key parses
  as the boolean `true`. `yamlVersion` is pinned to `"1.2"` here so the language
  server cannot reproduce that false alarm.
- The schema catches real mistakes, confirmed by mutation: `runs_on` (underscore
  typo), a misspelled `pull_reqest` trigger, `timeout-minutes` given as a string,
  `steps` written as a mapping instead of a list, and an unknown job-level key.
- Both JSON baseline schemas validate their real files, and reject a negative
  count, a string where an integer belongs, a typo'd top-level key, a missing
  required section, and a string `limit`.
