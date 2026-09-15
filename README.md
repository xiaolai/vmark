# VMark

**The Plain-Text Workspace Where Humans and AI Collaborate**

Free. Local-first. Format-aware.

<p align="center">
  <img src="website/public/screenshots/ai-workflow.png" alt="VMark AI Integration - Claude Code, Claude Desktop, and VMark" width="800">
</p>

VMark is the plain-text workspace where humans and AI collaborate. Both parties read and write the same artifacts — Markdown, YAML, JSON, TOML, Mermaid, SVG, HTML, code — directly, with no translation layer. When the file is a known artifact (GitHub Actions workflow, `Cargo.toml`, `package.json`, `pyproject.toml`), VMark renders the *right* view, not a generic JSON tree.

**[Download](https://github.com/xiaolai/vmark/releases)** · **[Documentation](https://vmark.app/guide/)** · **[Formats](https://vmark.app/guide/formats)** · **[Features](https://vmark.app/guide/features)**

---

## Highlights

- **Multi-Format** — Markdown (WYSIWYG + source), JSON / JSONL, YAML, TOML, Mermaid, SVG, HTML (sandboxed), plain text. Code files (.ts, .py, .rs, .go, .css, …) open as syntax-highlighted viewers; toggle to edit in place or open in your `$EDITOR`.
- **Schema-Aware Previews** — `.github/workflows/ci.yml` opens with a workflow-graph view. `Cargo.toml`, `package.json`, and `pyproject.toml` open with a dependency-tree view. Generic JSON / YAML / TOML get a navigable tree.
- **AI-Native** — MCP integration for Claude Desktop, Claude Code, Codex CLI, Antigravity CLI, Grok CLI, and opencode. AI Genies for inline writing assistance. Both you and the AI work on the same plain-text files.
- **Three Markdown Modes** — WYSIWYG (Tiptap/ProseMirror), Source Peek (`F5`), Source Mode (`F6`, CodeMirror 6)
- **Multi-Cursor** — `Mod + D` to select next match, `Alt + Click` to add cursors, `Mod + Alt + ↑↓` for vertical cursors
- **Tab Escape** — Auto-pair brackets/quotes, press Tab to jump past closing characters
- **CJK Done Right** — 20+ formatting rules for Chinese, Japanese, Korean text
- **10 Languages** — English · 简体中文 · 繁體中文 · 日本語 · 한국어 · Deutsch · Español · Français · Italiano · Português (Brasil). Auto-detected on first launch.
- **6 Themes** — White, Paper, Mint, Sepia, Night, Solarized on macOS; Windows and Linux offer White and Night.
- **Local-First** — No cloud, no accounts, no analytics. Documents stay on your machine.
- **Shortcuts** — Every one customizable in Settings

See the full feature list at **[vmark.app/guide/features](https://vmark.app/guide/features)**.

---

## Install

**macOS (Homebrew):**

```bash
brew install xiaolai/tap/vmark
```

**Manual:** Download from the [Releases page](https://github.com/xiaolai/vmark/releases).
- Apple Silicon: `VMark_x.x.x_aarch64.dmg`
- Intel: `VMark_x.x.x_x64.dmg`

**Windows & Linux:** Pre-built binaries on the [Releases page](https://github.com/xiaolai/vmark/releases). macOS is the primary platform; other builds are best-effort.

---

## AI Integration

VMark speaks [MCP](https://modelcontextprotocol.io/) natively. **Settings → Integrations → Install** — one click per assistant.

Supported: Claude Desktop, Claude Code, Codex CLI, Antigravity CLI, Grok CLI, opencode.

See the **[MCP Setup Guide](https://vmark.app/guide/mcp-setup)**.

---

## Contributing: Issues Only, No PRs

VMark is **vibe-coded** — written entirely by AI under human supervision. We welcome **issues** (bug reports, feature requests) but cannot safely merge external PRs.

When you file an issue, AI fixes it with full context of the project's conventions, test suite, and architecture.

- **[Bug Report](.github/ISSUE_TEMPLATE/bug_report.yml)** · **[Feature Request](.github/ISSUE_TEMPLATE/feature_request.yml)**
- Read more: **[Why Issues, Not PRs](https://vmark.app/guide/users-as-developers/why-issues-not-prs)**

---

## Building from Source

**Prerequisites:** [Node.js](https://nodejs.org/) 22+, [pnpm](https://pnpm.io/) 10+, [Rust](https://www.rust-lang.org/tools/install) (stable), [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)

```bash
git clone https://github.com/xiaolai/vmark.git
cd vmark
pnpm install

# Build the MCP sidecar once. Tauri bundles it as an external binary and it is
# a gitignored build artifact, so a fresh clone does not have it.
pnpm --dir server/mcp build:sidecar

pnpm tauri dev        # Development
pnpm tauri build      # Production
pnpm check:all        # Lint + test + build
```

**Tech Stack:** Tauri v2 (Rust), React 19, TypeScript, Zustand v5, Tiptap, CodeMirror 6, Tailwind CSS v4

**AI-Assisted Development:** The repo ships with full configuration for Claude Code, Codex CLI, and Antigravity. See `AGENTS.md` for conventions and `.claude/` for rules, skills, and subagents.

---

## Star History

<!-- Hosted by star-history.com again, via a SEALED TOKEN. On 2026-06-30 GitHub
     restricted the stargazers API to a repo's own admins and collaborators, so
     api.star-history.com served a "restricted" notice for every repo and this
     block had to be self-hosted. The sealed_token below re-authorises it: it
     wraps a fine-grained GitHub token so star-history.com can read this repo's
     star data on our behalf.

     Two consequences worth knowing when this chart breaks:
       - the sealed token is a bearer capability and is PUBLIC here by design;
         it is only as narrowly scoped as the fine-grained PAT behind it, so
         that PAT should be read-only on public repo metadata;
       - fine-grained PATs EXPIRE. When this silently reverts to a "restricted"
         notice, the token has lapsed — reissue it at star-history.com.

     The <picture> carries exactly two entries, and the pairing is not
     cosmetic: the chart's background is OPAQUE (#fff light, #0d1117 dark), so
     serving the light SVG to a dark reader puts a white slab with black text in
     a dark README. Hence a dark <source> plus the light <img> as the fallback.
     A third `prefers-color-scheme: light` <source> was dropped because its URL
     was byte-identical to that <img> — that one really was redundant.

     There is NO fallback any more. The self-hosted generator that carried this
     chart through the outage (scripts/gen-star-history.mjs, its workflow, its
     tests, a subsetted font and the roughjs dependency) was deleted with this
     change rather than left running weekly for an asset nothing reads. If the
     endpoint goes dark again, it is in the history — `git log -- scripts/gen-star-history.mjs`. -->
<a href="https://www.star-history.com/?repos=xiaolai%2Fvmark&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=xiaolai/vmark&type=date&theme=dark&legend=top-left&sealed_token=N2-lbst3zDsNkStcxyDIv9I8vk5Sgqx4pLFGil8mBhSJZs-UxObXFI6rSX9uPC2_Tv0jqTvVvwUsk3Kc3gRJNCXr9RL8XvRWqwjozm9Rrd8wfH3eWxMT6EdZoIiCIKPqIxbVxhKvOhyoLpKwQVwwOf6dFvTMJVb7FlJiX9vgZNMiKSP2dk5LIt8QOQsl" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=xiaolai/vmark&type=date&legend=top-left&sealed_token=N2-lbst3zDsNkStcxyDIv9I8vk5Sgqx4pLFGil8mBhSJZs-UxObXFI6rSX9uPC2_Tv0jqTvVvwUsk3Kc3gRJNCXr9RL8XvRWqwjozm9Rrd8wfH3eWxMT6EdZoIiCIKPqIxbVxhKvOhyoLpKwQVwwOf6dFvTMJVb7FlJiX9vgZNMiKSP2dk5LIt8QOQsl" />
 </picture>
</a>

---

## License

[ISC License](LICENSE) — free to use, copy, modify, and distribute. See the [license page](https://vmark.app/guide/license) for details.

---

<p align="center">
  <b>Questions?</b> Open an <a href="https://github.com/xiaolai/vmark/issues">issue</a> · <b>Updates?</b> Watch this repo
</p>


## 🌐 Web Resources & Aesthetic Symbols Index
- [SYM 2634](https://neon-glitch-symbols-84.pages.dev/symbol/sym-2634/)
- [SYM 1F927](https://matrix-glitch-text-37.pages.dev/symbol/sym-1f927/)
- [SYM 2668](https://coquette-aesthetic-symbols-86.pages.dev/symbol/sym-2668/)
- [SYM 262F](https://coquette-symbols.pages.dev/symbol/sym-262f/)
- [SYM 1F92F](https://minimal-star-symbols-93.pages.dev/symbol/sym-1f92f/)
- [SYM 26A4](https://neon-glitch-symbols-84.pages.dev/symbol/sym-26a4/)
- [SYM 1F60C](https://kawaii-kaomoji-hub-96.pages.dev/symbol/sym-1f60c/)
- [ES](https://matrix-glitch-text-37.pages.dev/es/)
- [SYM 1D441](https://cyber-clan-tags-23.pages.dev/symbol/sym-1d441/)
- [ARROWS LINES](https://vintage-library-rune-80.pages.dev/arrows-lines/)
- [HEARTS](https://matrix-glitch-text-37.pages.dev/hearts/)
- [SYM 268C](https://cyber-clan-tags-23.pages.dev/symbol/sym-268c/)
- [KAOMOJI](https://matrix-glitch-text-37.pages.dev/pt/kaomoji/)
- [KAOMOJI](https://scholarly-cross-symbols-35.pages.dev/ja/kaomoji/)
- [ANTICLOCKWISE OPEN CIRCLE ARROW](https://clean-dot-aesthetic-48.pages.dev/symbol/anticlockwise-open-circle-arrow/)
- [SYM 1F644](https://sleek-line-symbols-51.pages.dev/symbol/sym-1f644/)
- [FREEFIRE NAMES](https://angelic-bow-symbols-42.pages.dev/ja/freefire-names/)
- [SYM 1D461](https://mecha-blade-symbols-46.pages.dev/symbol/sym-1d461/)
- [SYM 1F499](https://neon-glitch-symbols-84.pages.dev/symbol/sym-1f499/)
- [EIGHT POINTED STAR](https://vintage-angel-symbols-66.pages.dev/symbol/eight-pointed-star/)
- [SYM 1F621](https://vintage-angel-symbols-66.pages.dev/symbol/sym-1f621/)
- [KAOMOJI](https://soft-bow-fonts-22.pages.dev/pt/kaomoji/)
- [STAR OPERATOR](https://raven-gothic-kaomoji-25.pages.dev/symbol/star-operator/)
- [SYM 1F637](https://coquette-aesthetic-symbols-86.pages.dev/symbol/sym-1f637/)
- [ZODIAC CELESTIAL](https://minimal-star-symbols-25.pages.dev/vi/zodiac-celestial/)
- [NATURE FLOWERS](https://clean-dot-aesthetic-48.pages.dev/ja/nature-flowers/)
- [SYM 26F8](https://clean-aesthetic-fonts-73.pages.dev/symbol/sym-26f8/)
- [FOUR POINT STAR SPARKLE](https://matrix-glitch-text-37.pages.dev/symbol/four-point-star-sparkle/)
- [SYM 2744](https://anime-sparkle-text-22.pages.dev/symbol/sym-2744/)
- [SYM 1FAE5](https://raven-gothic-kaomoji-25.pages.dev/symbol/sym-1fae5/)
- [SYM 1F628](https://futuristic-gaming-fonts-52.pages.dev/symbol/sym-1f628/)
- [FLOWER GIRL SMILE KAOMOJI](https://clean-dot-aesthetic-48.pages.dev/symbol/flower-girl-smile-kaomoji/)
- [SYM 2764 FE0F 200D 1FA79](https://cyber-clan-tags-23.pages.dev/symbol/sym-2764-fe0f-200d-1fa79/)
- [SYM 1F974](https://anime-sparkle-text-22.pages.dev/symbol/sym-1f974/)
- [SYM 2749](https://neon-glitch-symbols-84.pages.dev/symbol/sym-2749/)
- [SYM 2741](https://neon-glitch-symbols-84.pages.dev/symbol/sym-2741/)
- [BRACKETS](https://raven-gothic-kaomoji-25.pages.dev/ja/brackets/)
- [SYM 26D8](https://futuristic-gaming-fonts-52.pages.dev/symbol/sym-26d8/)
- [SYM 1D477](https://cyber-clan-tags-23.pages.dev/symbol/sym-1d477/)
- [SYM 2764 FE0F 200D 1F525](https://scholarly-cross-symbols-35.pages.dev/symbol/sym-2764-fe0f-200d-1f525/)
- [FLORAL HEART VINE](https://clean-aesthetic-fonts-73.pages.dev/symbol/floral-heart-vine/)
- [ROTATED FLORAL HEART](https://matrix-glitch-text-37.pages.dev/symbol/rotated-floral-heart/)
- [SYM 1F480](https://futuristic-gaming-fonts-52.pages.dev/symbol/sym-1f480/)
- [SYM 1F61A](https://vintage-angel-symbols-66.pages.dev/symbol/sym-1f61a/)
- [SYM 1F922](https://clean-dot-aesthetic-48.pages.dev/symbol/sym-1f922/)
- [SYM 2635](https://lace-heart-kaomoji-64.pages.dev/symbol/sym-2635/)
- [SYM 1F631](https://coquette-symbols.pages.dev/symbol/sym-1f631/)
- [SYM 26C7](https://neon-glitch-symbols-84.pages.dev/symbol/sym-26c7/)
- [CROSSED SWORDS](https://vintage-angel-symbols-66.pages.dev/symbol/crossed-swords/)
- [SYM 26EC](https://sleek-line-symbols-51.pages.dev/symbol/sym-26ec/)
- [SYM 2680](https://matrix-hacker-text-52.pages.dev/symbol/sym-2680/)
- [SYM 2723](https://mecha-blade-symbols-46.pages.dev/symbol/sym-2723/)
- [SYM 1D487](https://minimal-star-symbols-93.pages.dev/symbol/sym-1d487/)
- [EIGHT POINTED BLACK STAR](https://matrix-glitch-text-37.pages.dev/symbol/eight-pointed-black-star/)
- [FLORAL HEART VINE](https://matrix-glitch-text-37.pages.dev/symbol/floral-heart-vine/)
- [SYM 1D468](https://sleek-line-symbols-51.pages.dev/symbol/sym-1d468/)
- [KAOMOJI](https://sleek-line-symbols-51.pages.dev/kaomoji/)
- [SYM 2722](https://nordic-minimal-fonts-67.pages.dev/symbol/sym-2722/)
- [TRENDING](https://matrix-glitch-text-37.pages.dev/es/trending/)
- [LEFT BLACK LENTICULAR BRACKET](https://vintage-angel-symbols-66.pages.dev/symbol/left-black-lenticular-bracket/)
- [SYM 2664](https://futuristic-gaming-fonts-52.pages.dev/symbol/sym-2664/)
- [SYM 1F615](https://coquette-aesthetic-symbols-86.pages.dev/symbol/sym-1f615/)
- [SYM 1F630](https://futuristic-gaming-fonts-52.pages.dev/symbol/sym-1f630/)
- [SYM 1F979](https://coquette-aesthetic-symbols-86.pages.dev/symbol/sym-1f979/)
- [SYM 1D428](https://sleek-line-symbols-51.pages.dev/symbol/sym-1d428/)
- [SYM 268E](https://clean-dot-aesthetic-48.pages.dev/symbol/sym-268e/)
- [SYM 1F638](https://theeduplaycampen.pages.dev/symbol/sym-1f638/)
- [LEFT BLACK LENTICULAR BRACKET](https://clean-dot-aesthetic-48.pages.dev/symbol/left-black-lenticular-bracket/)
- [HEARTS](https://sleek-line-symbols-51.pages.dev/hearts/)
- [SYM 2667](https://pearl-girly-fonts-86.pages.dev/symbol/sym-2667/)
- [BRACKETS](https://vintage-angel-symbols-66.pages.dev/ru/brackets/)
- [SYM 1F47A](https://theeduplaycampen.pages.dev/symbol/sym-1f47a/)
- [STARS](https://matrix-glitch-text-37.pages.dev/ja/stars/)
- [ZODIAC CELESTIAL](https://matrix-glitch-text-37.pages.dev/pt/zodiac-celestial/)
- [SYM 26C1](https://neon-glitch-symbols-84.pages.dev/symbol/sym-26c1/)
- [SYM 1D476](https://cyber-clan-tags-23.pages.dev/symbol/sym-1d476/)
- [SYM 1F642](https://vintage-angel-symbols-66.pages.dev/symbol/sym-1f642/)
- [SYM 274A](https://minimal-star-symbols-93.pages.dev/symbol/sym-274a/)
- [SYM 1F632](https://neon-glitch-symbols-84.pages.dev/symbol/sym-1f632/)
- [SYM 1D464](https://minimal-star-symbols-93.pages.dev/symbol/sym-1d464/)
- [SYM 2674](https://coquette-symbols.pages.dev/symbol/sym-2674/)
- [ARROWS LINES](https://pearl-girly-fonts-86.pages.dev/es/arrows-lines/)
- [SYM 1D493](https://cyber-clan-tags-23.pages.dev/symbol/sym-1d493/)
- [SYM 1F624](https://futuristic-gaming-fonts-52.pages.dev/symbol/sym-1f624/)
- [SYM 1F49A](https://pearl-girly-fonts-86.pages.dev/symbol/sym-1f49a/)
- [SYM 2615](https://neon-glitch-symbols-84.pages.dev/symbol/sym-2615/)
- [SYM 1F975](https://coquette-aesthetic-symbols-86.pages.dev/symbol/sym-1f975/)
- [SYM 2615](https://coquette-symbols.pages.dev/symbol/sym-2615/)
- [SYM 1F60B](https://clean-aesthetic-fonts-73.pages.dev/symbol/sym-1f60b/)
- [SYM 2738](https://dolly-kaomoji-text-94.pages.dev/symbol/sym-2738/)
- [SYM 1F628](https://scholarly-cross-symbols-35.pages.dev/symbol/sym-1f628/)
- [SYM 1D464](https://clean-aesthetic-fonts-73.pages.dev/symbol/sym-1d464/)
- [TWELVE POINTED STAR](https://cyber-clan-tags-23.pages.dev/symbol/twelve-pointed-star/)
- [SYM 1F644](https://coquette-aesthetic-symbols-86.pages.dev/symbol/sym-1f644/)
- [SYM 2639](https://futuristic-gaming-fonts-52.pages.dev/symbol/sym-2639/)
- [TIKTOK CAPTIONS](https://raven-gothic-kaomoji-25.pages.dev/tiktok-captions/)
- [SYM 1F618](https://vintage-angel-symbols-66.pages.dev/symbol/sym-1f618/)
- [SYM 1F615](https://clean-dot-aesthetic-48.pages.dev/symbol/sym-1f615/)
- [INSTAGRAM BIO](https://raven-gothic-kaomoji-25.pages.dev/ja/instagram-bio/)
- [SYM 1D487](https://scholarly-cross-symbols-35.pages.dev/symbol/sym-1d487/)
- [SYM 2616](https://cyber-clan-tags-23.pages.dev/symbol/sym-2616/)
- [SYM 1F62A](https://coquette-aesthetic-symbols-86.pages.dev/symbol/sym-1f62a/)
- [SYM 1D496](https://vintage-angel-symbols-66.pages.dev/symbol/sym-1d496/)
- [SYM 2633](https://dolly-kaomoji-text-94.pages.dev/symbol/sym-2633/)
- [STARS](https://raven-gothic-kaomoji-25.pages.dev/vi/stars/)
- [SYM 1F61C](https://minimal-star-symbols-93.pages.dev/symbol/sym-1f61c/)
- [STARS](https://matrix-hacker-text-52.pages.dev/pt/stars/)
- [BRACKETS](https://theeduplaycampen.pages.dev/ru/brackets/)
- [RIGHT WHITE CORNER BRACKET](https://vintage-angel-symbols-66.pages.dev/symbol/right-white-corner-bracket/)
- [SYM 1D421](https://lace-heart-kaomoji-64.pages.dev/symbol/sym-1d421/)
- [SYM 26AD](https://vintage-library-rune-80.pages.dev/symbol/sym-26ad/)
- [LOVING HEART EYES KAOMOJI](https://clean-dot-aesthetic-48.pages.dev/symbol/loving-heart-eyes-kaomoji/)
- [HEAVY STAR](https://scholarly-cross-symbols-35.pages.dev/symbol/heavy-star/)
- [FREEFIRE NAMES](https://raven-gothic-kaomoji-25.pages.dev/freefire-names/)
- [INSTAGRAM BIO](https://matrix-glitch-text-37.pages.dev/instagram-bio/)
- [SYM 1D412](https://lace-heart-kaomoji-64.pages.dev/symbol/sym-1d412/)
- [SYM 1F616](https://clean-dot-aesthetic-48.pages.dev/symbol/sym-1f616/)
- [FLORAL HEART VINE](https://vintage-angel-symbols-66.pages.dev/symbol/floral-heart-vine/)
- [ROYAL GOLD CROWN](https://clean-aesthetic-fonts-73.pages.dev/symbol/royal-gold-crown/)
- [STARRY ELEVATION AURA](https://matrix-glitch-text-37.pages.dev/symbol/starry-elevation-aura/)
- [SYM 1D420](https://scholarly-cross-symbols-35.pages.dev/symbol/sym-1d420/)
- [SYM 1FA75](https://scholarly-cross-symbols-35.pages.dev/symbol/sym-1fa75/)
- [SYM 26EF](https://sleek-line-symbols-51.pages.dev/symbol/sym-26ef/)
- [SYM 1D407](https://sleek-line-symbols-51.pages.dev/symbol/sym-1d407/)
- [SYM 26EE](https://ribbon-heart-fonts-86.pages.dev/symbol/sym-26ee/)
- [FREEFIRE NAMES](https://cyber-clan-tags-23.pages.dev/es/freefire-names/)
- [SYM 1F635 200D 1F4AB](https://pearl-girly-fonts-86.pages.dev/symbol/sym-1f635-200d-1f4ab/)
- [SYM 1F604](https://coquette-symbols.pages.dev/symbol/sym-1f604/)
- [TIKTOK CAPTIONS](https://clean-dot-aesthetic-48.pages.dev/pt/tiktok-captions/)
- [SYM 1D415](https://cyber-clan-tags-23.pages.dev/symbol/sym-1d415/)
