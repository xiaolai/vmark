#!/usr/bin/env node
/**
 * UserPromptSubmit hook: refine prompts via Claude Haiku.
 *
 * Trigger: prefix your prompt with "::" or ">>"
 *   :: 把这个函数改成异步的
 *   >> make the thing work better
 *
 * The refined prompt is copied to clipboard. Paste it back to send.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── project context (loaded once at startup) ─────────────────────────

function loadProjectContext() {
  try {
    const hookDir = dirname(fileURLToPath(import.meta.url));
    const contextPath = resolve(hookDir, "project-context.txt");
    const text = readFileSync(contextPath, "utf-8").trim();
    return `\n\nProject context:\n${text}`;
  } catch {
    return "";
  }
}

const PROJECT_CONTEXT = loadProjectContext();

const SYSTEM_PROMPT = `You are a prompt optimizer for Claude Code — an AI coding CLI with these capabilities:
- Read, write, and edit files (Read, Write, Edit tools)
- Run shell commands (Bash tool)
- Search files by pattern (Glob) and content (Grep)
- Use MCP tools (Codex for cross-model audits, Tauri for E2E testing)
- Enter plan mode for complex multi-step tasks
- Delegate to specialized subagents for parallel work${PROJECT_CONTEXT}

Transform the user’s raw input into an optimized prompt for this tool.

## Rules (in priority order)

1. PRESERVE intent — never add, remove, or invent requirements the user didn’t express.
2. TRANSLATE non-English to clear English. Keep technical terms untranslated (function names, file paths, library names, CLI commands).
3. CLARIFY scope — when the user hints at specific files, functions, or behaviors, make them explicit.
4. IMPERATIVE voice — start with a verb: "Add…", "Fix…", "Refactor…", "Update…"
5. STRUCTURE complex requests — state the goal first, then context and constraints.
6. STRIP filler — remove pleasantries, hedging, and unnecessary words.
7. PASS THROUGH — if input is already a clear English prompt, return it with minimal changes.

## Output format

- 1–2 sentences for simple requests.
- 3–5 sentences for complex multi-step requests.
- Output ONLY the refined prompt. No preamble, no explanation, no markdown fences, no quotes.

## Examples

Input: 把这个函数改成异步的
Output: Convert this function to async/await.

Input: 这个组件太大了，拆一下
Output: Split this component into smaller focused components. Extract shared logic into custom hooks.

Input: the save thing doesn’t work when there’s no file
Output: Fix the save command to handle untitled documents — prompt for a file path instead of silently failing.

Input: 把 useEffect 的 cleanup 加上，不然会有内存泄潏
Output: Add a cleanup function to the useEffect hook to prevent memory leaks.

Input: 我想加个功能，在侧边栏显示文件大小，还有最后修改时间，鼠标悬停的时候显示完整路径
Output: Add file metadata to the sidebar: show file size and last-modified time inline. Display the full file path in a tooltip on hover.

Input: >> make the search faster it’s really slow with big files
Output: Optimize the search implementation for large files. Profile the current bottleneck and consider debouncing, web workers, or incremental matching.`;

// ── helpers ──────────────────────────────────────────────────────────

function block(reason) {
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

function copyToClipboard(text) {
  try {
    execSync("pbcopy", { input: text, stdio: ["pipe", "ignore", "ignore"] });
  } catch {
    // Non-macOS or pbcopy unavailable — silently skip
  }
}

// ── main ─────────────────────────────────────────────────────────────

const data = JSON.parse(await readStdin());
const raw = (data.prompt || "").trimStart();

// Opt-in: only trigger on :: or >> prefix
const match = raw.match(/^(::|\>\>)\s*/);
if (!match) process.exit(0);

const text = raw.slice(match[0].length).trim();

if (!text) {
  block("Nothing to refine. Provide text after the prefix, or send without it.");
}

if (text.length < 8 || /^(go ahead|ok|okay|yes|no|continue|next|option\s*\d+|\d+)$/i.test(text)) {
  block("Skipped: too short or low-signal. Re-send without the prefix.");
}

try {
  let result = "";

  for await (const msg of query({
    prompt: text,
    options: {
      model: "claude-haiku-4-5-20251001",
      systemPrompt: SYSTEM_PROMPT,
      tools: [],
      maxTurns: 1,
      persistSession: false,
    },
  })) {
    if (msg.type === "result") {
      if (msg.subtype === "success") {
        result = (msg.result || "").trim();
      } else {
        block(`Refinement failed: ${(msg.errors || []).join(", ") || "unknown error"}`);
      }
    }
  }

  if (!result) block("Refinement produced empty output.");

  copyToClipboard(result);
  block("Refined prompt (copied to clipboard):\n" + result);
} catch (err) {
  block(`Refinement error: ${err.message || err}`);
}
