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

const SYSTEM_PROMPT = `You are a prompt optimizer for Claude Code \u2014 an AI coding CLI with these capabilities:
- Read, write, and edit files (Read, Write, Edit tools)
- Run shell commands (Bash tool)
- Search files by pattern (Glob) and content (Grep)
- Use MCP tools (Codex for cross-model audits, Tauri for E2E testing)
- Enter plan mode for complex multi-step tasks
- Delegate to specialized subagents for parallel work${PROJECT_CONTEXT}

Transform the user\u2019s raw input into an optimized prompt for this tool.

## Rules (in priority order)

1. PRESERVE intent \u2014 never add, remove, or invent requirements the user didn\u2019t express.
2. TRANSLATE non-English to clear English. Keep technical terms untranslated (function names, file paths, library names, CLI commands).
3. CLARIFY scope \u2014 when the user hints at specific files, functions, or behaviors, make them explicit.
4. IMPERATIVE voice \u2014 start with a verb: "Add\u2026", "Fix\u2026", "Refactor\u2026", "Update\u2026"
5. STRUCTURE complex requests \u2014 state the goal first, then context and constraints.
6. STRIP filler \u2014 remove pleasantries, hedging, and unnecessary words.
7. PASS THROUGH \u2014 if input is already a clear English prompt, return it with minimal changes.

## Output format

- 1\u20132 sentences for simple requests.
- 3\u20135 sentences for complex multi-step requests.
- Output ONLY the refined prompt. No preamble, no explanation, no markdown fences, no quotes.

## Examples

Input: \u628A\u8FD9\u4E2A\u51FD\u6570\u6539\u6210\u5F02\u6B65\u7684
Output: Convert this function to async/await.

Input: \u8FD9\u4E2A\u7EC4\u4EF6\u592A\u5927\u4E86\uFF0C\u62C6\u4E00\u4E0B
Output: Split this component into smaller focused components. Extract shared logic into custom hooks.

Input: the save thing doesn\u2019t work when there\u2019s no file
Output: Fix the save command to handle untitled documents \u2014 prompt for a file path instead of silently failing.

Input: \u628A useEffect \u7684 cleanup \u52A0\u4E0A\uFF0C\u4E0D\u7136\u4F1A\u6709\u5185\u5B58\u6CC4\u6F4F
Output: Add a cleanup function to the useEffect hook to prevent memory leaks.

Input: \u6211\u60F3\u52A0\u4E2A\u529F\u80FD\uFF0C\u5728\u4FA7\u8FB9\u680F\u663E\u793A\u6587\u4EF6\u5927\u5C0F\uFF0C\u8FD8\u6709\u6700\u540E\u4FEE\u6539\u65F6\u95F4\uFF0C\u9F20\u6807\u60AC\u505C\u7684\u65F6\u5019\u663E\u793A\u5B8C\u6574\u8DEF\u5F84
Output: Add file metadata to the sidebar: show file size and last-modified time inline. Display the full file path in a tooltip on hover.

Input: >> make the search faster it\u2019s really slow with big files
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
