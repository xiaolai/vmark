---
layout: home

hero:
  name: VMark
  text: AI Friendly Markdown Editor
  tagline: Write with Claude, Codex, or Gemini via MCP integration. Dual editing modes, CJK formatting, and seamless rich text / source switching.
  image:
    src: /logo.png
    alt: VMark
  actions:
    - theme: brand
      text: Download
      link: /download
    - theme: alt
      text: View Guide
      link: /guide/

features:
  - icon:
      src: /icons/edit.svg
    title: Dual Editing Modes
    details: Switch seamlessly between rich text (WYSIWYG) and source mode. Edit naturally with formatting preview or dive into raw Markdown.

  - icon:
      src: /icons/hard-drive.svg
    title: Local-First
    details: All your data stays on your machine. No cloud dependencies, no accounts required. Your files, your privacy.

  - icon:
      src: /icons/languages.svg
    title: CJK Formatting
    details: Built-in Chinese/Japanese/Korean text formatting with 19 configurable rules for perfect typography.

  - icon:
      src: /icons/git-branch.svg
    title: Mermaid Diagrams
    details: Render flowcharts, sequence diagrams, Gantt charts, and more directly in your documents.

  - icon:
      src: /icons/sigma.svg
    title: LaTeX Math
    details: KaTeX-powered mathematical equations with full syntax support and live preview.

  - icon:
      src: /icons/focus.svg
    title: Focus & Typewriter Modes
    details: Distraction-free writing with focus mode and typewriter scrolling for deep work sessions.

  - icon:
      src: /icons/folder-open.svg
    title: Workspace Support
    details: Open folders as workspaces with file tree navigation and easy file switching.

  - icon:
      src: /icons/keyboard.svg
    title: Keyboard-First
    details: Comprehensive keyboard shortcuts for everything. Customizable to match your workflow.

  - icon:
      src: /icons/palette.svg
    title: Beautiful Themes
    details: Five built-in themes including White, Paper, Mint, Sepia, and Night mode for comfortable writing.

  - icon:
      src: /icons/bot.svg
    title: AI Integration (MCP)
    details: Built-in MCP server lets AI assistants like Claude interact directly with your editor - read, write, and format documents.
---

<style>
/* Page-specific styles (shared styles in style.css) */
.home-content {
  max-width: 1152px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}

.tech-stack {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1rem;
}

.tech-badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 0.875rem;
  text-decoration: none;
  transition: background 0.2s, color 0.2s;
}

.tech-badge:hover {
  background: var(--vp-c-brand-1);
  color: var(--badge-hover-text);
}
</style>

<div class="home-content">

## See It in Action

<div class="screenshots-section">
<div class="screenshots-grid">
  <div class="screenshot-card">
    <img src="/screenshots/editor-main.png" alt="VMark Rich Text Editor" loading="lazy" />
    <div class="caption">Rich Text Mode</div>
  </div>
  <div class="screenshot-card">
    <img src="/screenshots/source-mode.png" alt="VMark Source Mode" loading="lazy" />
    <div class="caption">Source Mode</div>
  </div>
  <div class="screenshot-card">
    <img src="/screenshots/dark-theme.png" alt="VMark Night Theme" loading="lazy" />
    <div class="caption">Night Theme</div>
  </div>
</div>
</div>

## AI-Powered Writing

Let Claude write directly to your documents via MCP integration:

<div class="screenshots-section">
<div class="screenshots-grid">
  <div class="screenshot-card">
    <img src="/screenshots/mcp-claude.png" alt="Claude Desktop writing to VMark" loading="lazy" />
    <div class="caption">Claude Desktop writes to VMark</div>
  </div>
  <div class="screenshot-card">
    <img src="/screenshots/mcp-result.png" alt="AI content in VMark" loading="lazy" />
    <div class="caption">Content rendered instantly</div>
  </div>
</div>
</div>

[Learn how to set up MCP →](/guide/mcp-setup)

## Built With Modern Technology

<div class="tech-stack">
  <a href="https://tauri.app" target="_blank" class="tech-badge">Tauri v2</a>
  <a href="https://react.dev" target="_blank" class="tech-badge">React 19</a>
  <a href="https://www.typescriptlang.org" target="_blank" class="tech-badge">TypeScript</a>
  <a href="https://tiptap.dev" target="_blank" class="tech-badge">Tiptap</a>
  <a href="https://codemirror.net" target="_blank" class="tech-badge">CodeMirror 6</a>
  <a href="https://www.rust-lang.org" target="_blank" class="tech-badge">Rust</a>
</div>

## Cross-Platform

VMark is available for macOS, Windows, and Linux. Download the latest version and start writing today.

[Get VMark →](/download)

## Credits

<div class="credits-section">
  <div class="credits-row">
    <span class="credits-label">Producer</span>
    <a href="https://x.com/xiaolai" target="_blank" class="credit-link">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"/></svg>
      @xiaolai
    </a>
    <a href="https://github.com/xiaolai" target="_blank" class="credit-link">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
      GitHub
    </a>
    <a href="https://lixiaolai.com" target="_blank" class="credit-link">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm-1 17.938A8.004 8.004 0 0 1 4 12c0-.34.028-.674.074-1.002l5.926 5.927v1.009c0 1.093.907 2.004 2 2.004v-1zm6.426-2.318A1.994 1.994 0 0 0 15.5 16.5h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.412A7.997 7.997 0 0 1 20 12a7.96 7.96 0 0 1-2.574 5.62z"/></svg>
      lixiaolai.com
    </a>
  </div>
  <div class="credits-row">
    <span class="credits-label">Coders</span>
    <a href="https://claude.ai/code" target="_blank" class="credit-link">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/></svg>
      Claude Code
    </a>
    <a href="https://github.com/openai/codex" target="_blank" class="credit-link">
      <svg viewBox="0 0 16 16" fill="currentColor"><path d="M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934 4.1 4.1 0 0 0-1.778-.214 4.15 4.15 0 0 0-2.118-.114 4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679 4 4 0 0 0-1.14 1.253 3.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995.526.231 1.095.35 1.67.346 1.78.002 3.358-1.132 3.901-2.804a4.1 4.1 0 0 0 1.563-.68 4 4 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.506-4.716m-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778q.02.011.025.035v3.722c-.003 1.653-1.361 2.992-3.037 2.996m-6.53-2.75a2.95 2.95 0 0 1-.36-2.01l.095.057L5.29 12.09a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.022.041L6.473 13.3c-1.454.826-3.311.335-4.15-1.098m-.85-6.94A3.02 3.02 0 0 1 3.07 3.949v3.785a.51.51 0 0 0 .262.451l3.93 2.237-1.366.779a.05.05 0 0 1-.048 0L2.585 9.342a2.98 2.98 0 0 1-1.113-4.094zm11.216 2.571L8.747 5.576l1.362-.776a.05.05 0 0 1 .048 0l3.265 1.86a3 3 0 0 1 1.173 1.207 2.96 2.96 0 0 1-.27 3.2 3.05 3.05 0 0 1-1.36.997V8.279a.52.52 0 0 0-.276-.445m1.36-2.015-.097-.057-3.226-1.855a.53.53 0 0 0-.53 0L6.249 6.153V4.598a.04.04 0 0 1 .019-.04L9.533 2.7a3.07 3.07 0 0 1 3.257.139c.474.325.843.778 1.066 1.303.223.526.289 1.103.191 1.664zM5.503 8.575 4.139 7.8a.05.05 0 0 1-.026-.037V4.049c0-.57.166-1.127.476-1.607s.752-.864 1.275-1.105a3.08 3.08 0 0 1 3.234.41l-.096.054-3.23 1.838a.53.53 0 0 0-.265.455zm.742-1.577 1.758-1 1.762 1v2l-1.755 1-1.762-1z"/></svg>
      Codex CLI
    </a>
    <a href="https://github.com/google-gemini/gemini-cli" target="_blank" class="credit-link">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"/></svg>
      Gemini CLI
    </a>
  </div>
</div>

</div>
