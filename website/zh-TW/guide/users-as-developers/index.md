# 使用者即開發者

在 AI 程式設計工具的時代，「使用者」與「開發者」之間的界線正在消失。只要你能描述一個錯誤，就能修復它。只要你能想像一個功能，就能實現它 — 有了已經理解程式碼庫的 AI 助理。

VMark 擁抱這種理念。這個儲存庫已預先為 AI 程式設計工具載入了專案規則、架構文件和慣例。複製儲存庫、開啟你的 AI 助理，就可以開始貢獻 — AI 已經了解 VMark 的運作方式。

## 入門步驟

1. **複製儲存庫** — AI 設定已就緒。
2. **安裝你的 AI 工具** — [Claude Code](https://docs.anthropic.com/en/docs/claude-code)、[Codex CLI](https://github.com/openai/codex) 或 [Gemini CLI](https://github.com/google-gemini/gemini-cli)。
3. **開啟工作階段** — 工具會自動讀取 `AGENTS.md` 和規則。
4. **開始編程** — AI 了解專案慣例、測試要求和架構模式。

無需額外設定。直接請 AI 幫忙即可。

## 閱讀指南

初次接觸 AI 輔助開發？這些頁面循序漸進地介紹：

1. **[為什麼我要打造 VMark](/zh-TW/guide/users-as-developers/why-i-built-vmark)** — 一位非程式設計師從撰寫腳本到桌面應用程式的歷程
2. **[讓 AI 如虎添翼的五項基本人類技能](/zh-TW/guide/users-as-developers/what-are-indispensable)** — Git、TDD、終端機操作、英文和品味 — 一切的基礎
3. **[為什麼昂貴的模型反而更便宜](/zh-TW/guide/users-as-developers/why-expensive-models-are-cheaper)** — 每 Token 價格是虛榮指標，每任務成本才是重點
4. **[訂閱制 vs API 計費](/zh-TW/guide/users-as-developers/subscription-vs-api)** — 為何固定費率訂閱比按 Token 計費更划算
5. **[英文提示效果更好](/zh-TW/guide/users-as-developers/prompt-refinement)** — 翻譯、精煉提示，以及 `::` 快捷鍵
6. **[跨模型驗證](/zh-TW/guide/users-as-developers/cross-model-verification)** — 讓 Claude 與 Codex 互相稽核以提升程式碼品質
7. **[為什麼接受 Issues 而不是 PR](/zh-TW/guide/users-as-developers/why-issues-not-prs)** — 在 AI 維護的程式碼庫中，我們為何接受 Issues 而非 Pull Request
8. **[成本與工作量評估](/zh-TW/guide/users-as-developers/cost-evaluation)** — 人工團隊建構 VMark 的成本 vs. AI 輔助開發的實際花費

已熟悉基礎知識？直接跳至[跨模型驗證](/zh-TW/guide/users-as-developers/cross-model-verification)了解進階工作流程，或繼續閱讀了解 VMark 的 AI 設定如何運作。

## 一個檔案，通吃所有工具

各 AI 程式設計工具各自讀取不同的設定檔：

| 工具 | 設定檔 |
|------|--------|
| Claude Code | `CLAUDE.md` |
| Codex CLI | `AGENTS.md` |
| Gemini CLI | `GEMINI.md` |

在三個地方維護相同的指示容易出錯。VMark 以單一事實來源解決此問題：

- **`AGENTS.md`** — 包含所有專案規則、慣例和架構說明。
- **`CLAUDE.md`** — 僅一行：`@AGENTS.md`（Claude Code 指令，用於內嵌該檔案）。
- **Codex CLI** — 直接讀取 `AGENTS.md`。
- **Gemini CLI** — 在 `GEMINI.md` 中使用 `@AGENTS.md` 內嵌同一檔案。

只需更新 `AGENTS.md` 一次，所有工具都會自動獲取變更。

::: tip 什麼是 `@AGENTS.md`？
`@` 前綴是 Claude Code 指令，用於內嵌另一個檔案的內容。類似 C 語言中的 `#include` — `AGENTS.md` 的內容會在該位置插入 `CLAUDE.md` 中。詳情參見 [agents.md](https://agents.md/)。
:::

## 使用 Codex 作為第二意見

VMark 採用跨模型驗證 — Claude 撰寫程式碼，然後 Codex（OpenAI 的另一個 AI 模型）獨立稽核。這能發現單一模型可能遺漏的盲點。完整說明和設定指示請參閱[跨模型驗證](/zh-TW/guide/users-as-developers/cross-model-verification)。

## AI 掌握哪些資訊

當 AI 程式設計工具開啟 VMark 儲存庫時，會自動獲取：

### 專案規則（`.claude/rules/`）

這些檔案會自動載入每個 Claude Code 工作階段。涵蓋：

| 規則 | 執行內容 |
|------|---------|
| TDD 工作流程 | 測試優先為強制要求；覆蓋率閾值會阻止建置 |
| 設計令牌 | 禁止硬編碼顏色 — 完整 CSS 令牌參考已包含在內 |
| 元件模式 | 彈出視窗、工具列、右鍵選單模式附程式碼範例 |
| 焦點指示器 | 無障礙：鍵盤焦點必須始終可見 |
| 深色主題 | `.dark-theme` 選擇器規則、令牌一致性要求 |
| 鍵盤快捷鍵 | 三檔同步程序（Rust、TypeScript、文件） |
| 版本升級 | 五檔更新程序 |
| 程式碼庫慣例 | Store、Hook、Plugin、測試和匯入模式 |

### 自訂技能

斜線指令為 AI 提供特定能力：

| 指令 | 功能 |
|------|------|
| `/fix` | 正確修復問題 — 根本原因分析、TDD、不打補丁 |
| `/fix-issue` | 端對端 GitHub Issue 解決器（擷取、分支、修復、稽核、PR） |
| `/codex-audit` | 完整 9 維度程式碼稽核（安全性、正確性、合規性……） |
| `/codex-audit-mini` | 快速 5 維度小改動檢查 |
| `/codex-verify` | 驗證上次稽核的修復結果 |
| `/codex-commit` | 從變更分析智能生成提交訊息 |
| `/audit-fix` | 稽核、修復所有發現、驗證 — 重複至乾淨為止 |
| `/feature-workflow` | 端對端帶關卡工作流程，搭配專業代理 |
| `/merge-prs` | 依序審閱並合併開放中的 PR |
| `/bump` | 在所有 5 個檔案中升級版本、提交、標記、推送 |

### 專業代理

對於複雜任務，Claude Code 可委派給專注的子代理：

| 代理 | 角色 |
|------|------|
| 規劃者 | 研究最佳實踐、腦力激盪邊界情況、產出模組化計畫 |
| 實作者 | TDD 驅動的實作，含預先調查 |
| 稽核者 | 審閱差異以確認正確性和規則遵從性 |
| 測試執行者 | 執行關卡，透過 Tauri MCP 協調 E2E 測試 |
| 驗證者 | 發布前的最終檢查清單 |

## 私人覆寫

不是所有內容都適合放在共享設定中。個人偏好可使用：

| 檔案 | 共享？ | 用途 |
|------|--------|------|
| `AGENTS.md` | 是 | 所有 AI 工具的專案規則 |
| `CLAUDE.md` | 是 | Claude Code 入口點 |
| `.claude/settings.json` | 是 | 團隊共享權限 |
| `CLAUDE.local.md` | **否** | 你的個人指示（已加入 .gitignore） |
| `.claude/settings.local.json` | **否** | 你的個人設定（已加入 .gitignore） |

在專案根目錄建立 `CLAUDE.local.md`，填入只適用於你的指示 — 偏好語言、工作流程習慣、工具偏好。
