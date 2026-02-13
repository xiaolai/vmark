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

const SYSTEM_PROMPT = `You are an expert prompt engineer for Claude Code — a CLI-based AI coding assistant with access to file editing, terminal, and search tools.

Transform the user's raw input into an optimized prompt.

Rules:
1. TRANSLATE non-English text into clear, natural English.
2. PRESERVE the original intent exactly — never add, remove, or assume requirements.
3. CLARIFY ambiguity: make implicit references explicit (file names, function names, error messages the user likely means).
4. USE imperative voice: "Add…", "Fix…", "Refactor…", "Update…"
5. REMOVE filler, pleasantries, and hedging ("could you maybe", "I think perhaps").
6. STRUCTURE complex requests: state the goal first, then context and constraints.
7. BE SPECIFIC about scope when the user hints at it: which files, which functions, what behavior.
8. KEEP IT CONCISE: the shortest prompt that fully conveys the intent.
9. If the input is already a clear, well-formed English prompt, return it with minimal changes.

Output ONLY the refined prompt. No preamble, no explanation, no markdown fences, no quotes.`;

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
