#!/usr/bin/env node
/**
 * Purpose: refuse a commit whose MESSAGE contains an environment dump or a
 * credential. Invoked by `.githooks/commit-msg` with the path to the message
 * file; usable standalone as `node scripts/check-commit-message.mjs <file>`.
 *
 * WHY IT INSPECTS THE FINAL TEXT. Commit c506e3ff pasted the entire exported
 * environment — ~20 live credentials and the sudo password — into a commit
 * message that then sat on a public repo for six days. The mechanism was shell
 * command substitution: the message was composed through an unquoted heredoc
 * and contained the markdown code span `` `export` ``, so zsh executed
 * `export` and spliced its stdout into the text before git ever saw it.
 *
 * Every author-side remedy is a HABIT — "use -F", "single-quote it", "use an
 * editor" — and a habit is precisely what failed. Worse, the most tempting of
 * them is unsound: single quotes cannot contain an apostrophe, so a message
 * about "LogbookView's fields" closes the quote and re-exposes the rest of the
 * line to substitution. This gate runs after every quoting decision has already
 * been made, which is the only position from which the composition method
 * stops mattering.
 *
 * Key decisions:
 *   - SHAPE rules are anchored to line start; CONTENT rules (credential
 *     patterns, secret-named assignments) are not. A dump is recognised by its
 *     layout, so anchoring it costs nothing and keeps prose like "set
 *     environment=node" quiet. A leaked token can appear anywhere — including
 *     pasted mid-sentence — so anchoring that would be a hole.
 *   - The secret-named rule was anchored in the first draft on the ASSUMPTION
 *     that unanchoring would flag documentation prose. Measured instead:
 *     replaying both variants over all 4,533 commit messages in this repo's
 *     history, each flags exactly one message — c506e3ff, the real leak. The
 *     assumption was wrong and the anchor was pure cost, so it went.
 *   - An assignment needs a VALUE to count. `Read ANTHROPIC_API_KEY,
 *     OPENAI_API_KEY …` is a real commit in this repo's history; a gate that
 *     blocked it would be routed around within the week.
 *   - Comment lines and everything past the scissors line are dropped first,
 *     because git strips them and they therefore cannot leak.
 *   - Fails closed: an unreadable message file refuses the commit.
 *
 * Known limitations:
 *   - `git commit --cleanup=verbatim` keeps comment lines, which this gate has
 *     already discarded. An accidental substitution does not land in a comment
 *     line, so the exposure is theoretical rather than the observed failure.
 *   - Pattern coverage is a denylist: an unrecognised vendor's token with no
 *     secret-ish variable name and no dump around it passes. The dump rules are
 *     the backstop, and they are shape-based rather than vendor-based.
 *
 * @coordinates-with .githooks/commit-msg — the hook shim that calls this
 * @coordinates-with scripts/check-commit-message.test.mjs — the self-test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Policy refusal. Distinct from a usage/IO failure so callers can tell them apart. */
const EXIT_REFUSED = 65;
/** Usage error or unreadable input — fail closed, never a silent pass. */
const EXIT_USAGE = 64;

/** How many long line-start assignments constitute a dump. */
const DUMP_LINE_THRESHOLD = 5;
/** Minimum value length for an assignment to look like dumped data rather than prose. */
const MIN_DUMP_VALUE = 8;
/** How many distinct ambient process vars constitute a dump regardless of length. */
const AMBIENT_THRESHOLD = 3;

/**
 * Variables that belong to a process environment and essentially never appear
 * WITH A VALUE in hand-written prose. Three of these together is a dump.
 */
const AMBIENT_VARS = new Set([
  "PATH", "HOME", "SHELL", "PWD", "OLDPWD", "LOGNAME", "USER", "TMPDIR",
  "SSH_AUTH_SOCK", "TERM", "LANG", "SHLVL", "XPC_FLAGS", "XPC_SERVICE_NAME",
  "COMMAND_MODE", "INFOPATH", "MANPATH", "FPATH", "COLORTERM", "TERM_PROGRAM",
  "SECURITYSESSIONID", "LaunchInstanceID", "OSLogRateLimit", "GOPATH",
  "HOMEBREW_PREFIX", "HOMEBREW_CELLAR", "HOMEBREW_REPOSITORY", "BUN_INSTALL",
  "PNPM_HOME", "__CF_USER_TEXT_ENCODING", "__CFBundleIdentifier",
]);

/** Vendor credential shapes. Length bars are set so prose cannot reach them. */
const CREDENTIAL_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a PEM private key"],
  [/sk-ant-(?:api|oat)\d*-[A-Za-z0-9_-]{20,}/, "an Anthropic key"],
  [/sk-proj-[A-Za-z0-9_-]{20,}/, "an OpenAI project key"],
  [/sk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}/, "an OpenAI key"],
  [/github_pat_[A-Za-z0-9_]{40,}/, "a GitHub fine-grained token"],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, "a GitHub token"],
  [/glpat-[A-Za-z0-9_-]{20,}/, "a GitLab token"],
  [/npm_[A-Za-z0-9]{36,}/, "an npm token"],
  [/xai-[A-Za-z0-9]{40,}/, "an xAI key"],
  [/AIza[A-Za-z0-9_-]{35}/, "a Google API key"],
  [/hf_[A-Za-z0-9]{34,}/, "a Hugging Face token"],
  [/AKIA[0-9A-Z]{16}/, "an AWS access key id"],
  [/xox[baprs]-[A-Za-z0-9-]{20,}/, "a Slack token"],
  [/\bre_[A-Za-z0-9_]{24,}/, "a Resend key"],
];

/**
 * Variable-name fragments that make an assignment's value a credential.
 * Separators are `[-_]?` because the same name arrives as an env var
 * (`API_KEY`) and as a CLI flag (`--api-key`); matching only the underscore
 * spelling let `deploy --api-key=…` through.
 */
const SECRET_NAME =
  /(?:PASS(?:WORD)?|SECRET|TOKEN|API[-_]?KEY|PRIVATE[-_]?KEY|ACCESS[-_]?KEY|CREDENTIAL)/i;

/** Values that are obviously stand-ins rather than live material. */
const PLACEHOLDER =
  /^(?:[<{[].*[>}\]]|(.)\1{3,}|.*(?:your|example|placeholder|changeme|redacted|dummy|fake|sample).*)$/i;

/**
 * Credentials PUBLISHED as documentation examples. These match a real vendor
 * shape and are not secrets — AWS prints the first two in its own docs — so a
 * gate that flags them is wrong, not merely noisy.
 */
const DOC_EXAMPLES = new Set([
  "AKIAIOSFODNN7EXAMPLE",
  "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  "AKIAI44QH8DHBEXAMPLE",
]);

/** Shannon entropy in bits per character. */
function entropy(s) {
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Under `strictValues`, a secret-NAMED assignment must also look like random
 * material before it counts. Repos whose subject matter IS credentials — a
 * redactor, a key manager — legitimately write `client_secret=` and
 * `--password=` in prose, and flagging those trains the author to reach for
 * --no-verify, which is worse than no gate.
 *
 * Vendor patterns and the dump-shape rules are NOT relaxed by this: a real
 * environment dump still trips on its layout, which is what caught c506e3ff.
 */
function looksRandom(value) {
  return (
    value.length >= 20 &&
    /[0-9]/.test(value) &&
    /[A-Za-z]/.test(value) &&
    entropy(value) >= 3.0
  );
}

/** Line-start assignment — the SHAPE of a dumped environment. */
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
/**
 * Assignment anywhere, value ending at whitespace — a pasted credential.
 * `-` is in the name class so a CLI flag (`--api-key=…`) is captured whole;
 * without it the capture starts after the hyphen and yields the harmless `key`.
 */
const INLINE_ASSIGNMENT = /\b([A-Za-z_][A-Za-z0-9_-]*)=(\S{6,})/g;

/**
 * Strip what git itself removes: everything from the scissors line onward, then
 * every comment line. Neither can reach the stored message, so scanning them
 * would only generate false refusals.
 *
 * @param {string} raw full commit message file contents
 * @param {string} commentChar effective `core.commentChar`
 * @returns {string[]} the lines that will actually be committed
 */
export function committedLines(raw, commentChar) {
  const lines = raw.split(/\r?\n/);
  const scissors = lines.findIndex(
    (l) => l.startsWith(commentChar) && l.includes(">8"),
  );
  const body = scissors === -1 ? lines : lines.slice(0, scissors);
  return body.filter((l) => !l.startsWith(commentChar));
}

/**
 * Findings for a message body. Empty array means the message is clean.
 *
 * @param {string[]} lines the committed lines
 * @returns {{rule: string, detail: string}[]}
 */
export function findings(lines, options = {}) {
  const { strictValues = false } = options;
  const found = [];

  let longAssignments = 0;
  const ambient = new Set();

  for (const line of lines) {
    const m = ASSIGNMENT.exec(line);
    if (!m) continue;
    const [, name, value] = m;
    if (value === "" || PLACEHOLDER.test(value)) continue;

    if (value.length >= MIN_DUMP_VALUE) longAssignments += 1;
    if (AMBIENT_VARS.has(name)) ambient.add(name);
  }

  const text = lines.join("\n");

  for (const [, name, value] of text.matchAll(INLINE_ASSIGNMENT)) {
    if (!SECRET_NAME.test(name) || PLACEHOLDER.test(value)) continue;
    if (DOC_EXAMPLES.has(value)) continue;
    if (strictValues && !looksRandom(value)) continue;
    found.push({
      rule: "credential",
      detail: `\`${name}=…\` — a secret-named variable with a value`,
    });
  }

  if (longAssignments >= DUMP_LINE_THRESHOLD) {
    found.push({
      rule: "environment dump",
      detail: `${longAssignments} lines of \`NAME=value\` — this looks like a dumped environment`,
    });
  }
  if (ambient.size >= AMBIENT_THRESHOLD) {
    found.push({
      rule: "environment dump",
      detail: `ambient process variables present with values (${[...ambient].sort().slice(0, 5).join(", ")}…)`,
    });
  }

  for (const [pattern, label] of CREDENTIAL_PATTERNS) {
    const m = text.match(pattern);
    if (m && !DOC_EXAMPLES.has(m[0])) {
      found.push({ rule: "credential", detail: `${label} appears in the message` });
    }
  }

  return found;
}

const REMEDY = `
  How this happens: the shell — not git — expanded your message. A backtick or
  $(…) inside a double-quoted -m string, or inside an UNQUOTED heredoc, runs as
  a command and its output is spliced into the text. A markdown code span like
  \`export\` is all it takes.

  Compose the message so no shell ever parses it:
    git commit -F message.txt      # file written by an editor or a tool
    git commit -F - <<'EOF'        # note the QUOTED delimiter
    ...
    EOF

  Single-quoting -m is NOT a fix: an apostrophe ("the file's name") closes the
  quote and re-exposes the rest of the line.

  If this is a false positive, rephrase the line, or bypass with --no-verify
  (authorization required — see .claude/rules/60-ai-governance.md §9).`;

function main(argv) {
  const args = argv.filter((a) => !a.startsWith("--"));
  const charFlag = argv.find((a) => a.startsWith("--comment-char="));
  const commentChar = charFlag ? charFlag.slice("--comment-char=".length) : "#";

  const file = args[0];
  if (!file) {
    process.stderr.write(
      "check-commit-message: usage: check-commit-message.mjs <message-file> [--comment-char=X]\n",
    );
    return EXIT_USAGE;
  }

  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `check-commit-message: could not read message file "${file}": ${reason}\n`,
    );
    return EXIT_USAGE;
  }

  const strictValues = argv.includes("--strict-values");
  const hits = findings(committedLines(raw, commentChar || "#"), { strictValues });
  if (hits.length === 0) return 0;

  const seen = new Set();
  const unique = hits.filter((h) => {
    const key = `${h.rule}\u0000${h.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  process.stderr.write(
    `\ncommit refused — the message looks like it contains secrets.\n\n` +
      unique.map((h) => `  [${h.rule}] ${h.detail}\n`).join("") +
      `${REMEDY}\n\n`,
  );
  return EXIT_REFUSED;
}

// CLI entry — run only when invoked directly, never when imported by the test
// or by an auditing sweep over history.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
