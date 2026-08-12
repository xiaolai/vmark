/**
 * Commit-message secret gate — self-test.
 *
 * Runs the REAL `scripts/check-commit-message.mjs` as a subprocess against
 * fixture message files in a temp dir (house pattern: real script, tmpdir, no
 * in-process mocks).
 *
 * WHY THIS GATE EXISTS. Commit c506e3ff pasted the whole exported environment
 * — ~20 live credentials plus the sudo password — into a commit MESSAGE, and
 * pushed it to a public repo where it sat for six days. The mechanism was
 * shell command substitution: the message was composed through an UNQUOTED
 * heredoc and contained the markdown code span `` `export` ``, so zsh ran
 * `export` and spliced its stdout into the text before git ever saw it.
 *
 * Every proposed fix that lives in the author's head — "use -F", "single-quote
 * it", "use an editor" — is a habit, and a habit is what failed. This gate
 * inspects the FINAL message text, after every quoting decision has already
 * been made, so it holds regardless of how the message was composed.
 *
 * The two directions both matter and are both pinned here:
 *   - a dump/credential must be REFUSED, and
 *   - real historical messages from this repo that merely NAME env vars must
 *     PASS. `e7914501` ("Read ANTHROPIC_API_KEY, OPENAI_API_KEY … on settings
 *     mount") is a genuine commit; a gate that blocks it would be routed
 *     around within a week, which is how a gate becomes decoration.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-commit-message.mjs");

/** Exit code the gate uses to refuse a message (distinct from a crash). */
const REFUSED = 65;

let dir;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "vmark-commit-msg-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
/** Write `body` to a fixture file and run the real gate against it. */
function check(body, extraArgs = []) {
  const file = path.join(dir, `msg-${seq++}.txt`);
  writeFileSync(file, body);
  const r = spawnSync(process.execPath, [SCRIPT, file, ...extraArgs], {
    encoding: "utf8",
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("clean messages pass", () => {
  it("accepts an ordinary conventional-commit message", () => {
    const r = check(
      "fix(breakdown): remove four exports nobody imports\n\n" +
        "knip baseline: exports 17 vs 16, types 63 vs 59.\n" +
        "tsc clean; breakdown service + panel tests pass.\n",
    );
    expect(r.status).toBe(0);
  });

  it("accepts a message that NAMES env vars without values (real commit e7914501)", () => {
    const r = check(
      "feat: auto-fill REST API keys from environment variables\n\n" +
        "Read ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY / GEMINI_API_KEY\n" +
        "on settings mount and pre-fill empty API key fields automatically.\n",
    );
    expect(r.status).toBe(0);
  });

  it("accepts a documented flag assignment with a short value", () => {
    const r = check(
      "docs(hooks): explain the offline gate\n\n" +
        "VMARK_OFFLINE_GATE=1 runs the full legacy local gate instead.\n" +
        "CI=true is set by the runner.\n",
    );
    expect(r.status).toBe(0);
  });

  it("accepts prose that happens to contain an equals sign", () => {
    const r = check(
      "perf(tests): mark node-environment files\n\n" +
        "Set environment=node on 834 of 1439 files, taking the environment\n" +
        "phase from 5216s to 1904s.\n",
    );
    expect(r.status).toBe(0);
  });
});

describe("environment dumps are refused", () => {
  // The shape of the real leak: many `NAME=value` lines with long values.
  const DUMP = [
    "AI_AGENT=claude-code_2-1-223_agent",
    "BUN_INSTALL=/Users/joker/.bun",
    "COLORTERM=truecolor",
    "COMMAND_MODE=unix2003",
    "GOPATH=/Users/joker/go",
    "HOME=/Users/joker",
    "LANG=en_US.UTF-8",
    "LOGNAME=joker",
    "SHELL=/bin/zsh",
    "TERM=xterm-ghostty",
  ].join("\n");

  it("refuses a spliced environment dump", () => {
    const r = check(`fix: something\n\nDropping ${DUMP} keeps them usable.\n`);
    expect(r.status).toBe(REFUSED);
    expect(r.out).toMatch(/environment dump/i);
  });

  it("names the mechanism and the remedy in its output", () => {
    const r = check(`fix: something\n\nDropping ${DUMP} keeps them usable.\n`);
    // The whole point is that the author learns WHY, not just that it failed.
    expect(r.out).toMatch(/command substitution|backtick/i);
    expect(r.out).toMatch(/<<'EOF'|-F /);
  });

  it("refuses on the ambient-process signature even with short values", () => {
    // A dump of a minimal environment: few long values, but PATH/HOME/SHELL/PWD
    // together are not something a human writes into a commit message.
    const r = check(
      "fix: something\n\nPATH=/usr/bin\nHOME=/root\nSHELL=/bin/sh\nPWD=/tmp\n",
    );
    expect(r.status).toBe(REFUSED);
    expect(r.out).toMatch(/environment dump/i);
  });
});

describe("credential patterns are refused on a single occurrence", () => {
  // Values below are syntactically valid but fabricated — never real secrets.
  const CASES = [
    ["Anthropic OAuth", `CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-${"A".repeat(95)}`],
    ["Anthropic API", `key: sk-ant-api03-${"B".repeat(95)}`],
    ["OpenAI project", `OPENAI_API_KEY=sk-proj-${"C".repeat(74)}`],
    ["GitHub PAT", `token github_pat_${"D".repeat(22)}_${"E".repeat(59)}`],
    ["GitHub classic", `ghp_${"F".repeat(36)}`],
    ["npm publish", `NPM_TOKEN=npm_${"g".repeat(36)}`],
    ["xAI", `XAI_API_KEY=xai-${"h".repeat(80)}`],
    ["Google API", `GEMINI_API_KEY=AIza${"i".repeat(35)}`],
    ["Hugging Face", `hf_${"j".repeat(34)}`],
    ["AWS access key", `AKIA${"K".repeat(16)}`],
    ["Slack bot", `xoxb-123456789012-123456789012-${"m".repeat(24)}`],
    ["GitLab PAT", `glpat-${"n".repeat(20)}`],
  ];

  it.each(CASES)("refuses a %s token", (_label, secret) => {
    const r = check(`fix: something\n\nSee ${secret} for details.\n`);
    expect(r.status).toBe(REFUSED);
    expect(r.out).toMatch(/credential|secret/i);
  });

  it("refuses a PEM private key header", () => {
    const r = check(
      "fix: something\n\n-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n",
    );
    expect(r.status).toBe(REFUSED);
  });
});

describe("secret-named assignments are refused", () => {
  it.each([
    "SUDO_PASSWORD=hunter2hunter2",
    "REDDIT_CLIENT_SECRET=4b5-tEK-enP-r2b",
    "SOME_VENDOR_API_KEY=abcdef123456",
    "DB_PASSWORD=correcthorsebattery",
  ])("refuses `%s` at line start", (line) => {
    const r = check(`fix: something\n\n${line}\n`);
    expect(r.status).toBe(REFUSED);
    expect(r.out).toMatch(/credential|secret/i);
  });

  // The rule is deliberately NOT anchored to line start. Replaying both
  // variants over all 4,533 commit messages in this repo's history flagged
  // exactly one message either way — the real leak — so the anchor bought no
  // false-positive protection while leaving a pasted credential unseen.
  it("refuses a secret-named assignment pasted mid-sentence", () => {
    const r = check(
      "fix: deploy\n\nRan it with DEPLOY_TOKEN=abc123def456xyz and it worked.\n",
    );
    expect(r.status).toBe(REFUSED);
    expect(r.out).toMatch(/credential|secret/i);
  });

  it("refuses a secret-named flag value in a documented command", () => {
    const r = check(
      "chore: note the invocation\n\nRun `deploy --api-key=9f3c1aa47b2e5d80` to publish.\n",
    );
    expect(r.status).toBe(REFUSED);
  });

  it("does NOT refuse the same variable named without a value", () => {
    const r = check(
      "fix: something\n\nThe SUDO_PASSWORD and DB_PASSWORD vars are read at boot.\n",
    );
    expect(r.status).toBe(0);
  });

  it("does NOT refuse a placeholder value", () => {
    const r = check(
      "docs: document configuration\n\nSet MY_API_KEY=<your-key-here> before running.\n" +
        "Set OTHER_TOKEN=xxxxxxxxxxxx to disable.\n",
    );
    expect(r.status).toBe(0);
  });
});

describe("git's own message scaffolding is ignored", () => {
  it("ignores comment lines, which git strips before committing", () => {
    const r = check(
      "fix: something\n\n# AKIA" + "K".repeat(16) + "\n# HOME=/root\n",
    );
    expect(r.status).toBe(0);
  });

  it("ignores everything after the scissors line", () => {
    const r = check(
      "fix: something\n\n" +
        "# ------------------------ >8 ------------------------\n" +
        "diff --git a/x b/x\n+AKIA" +
        "K".repeat(16) +
        "\n",
    );
    expect(r.status).toBe(0);
  });

  it("honours a non-default comment char", () => {
    const r = check("fix: something\n\n; HOME=/root\n; AKIA" + "K".repeat(16) + "\n", [
      "--comment-char=;",
    ]);
    expect(r.status).toBe(0);
  });

  it("treats # as content when the comment char is something else", () => {
    const r = check(`fix: something\n\n# AKIA${"K".repeat(16)}\n`, [
      "--comment-char=;",
    ]);
    expect(r.status).toBe(REFUSED);
  });
});

describe("the gate fails closed", () => {
  it("refuses when the message file does not exist", () => {
    const r = spawnSync(
      process.execPath,
      [SCRIPT, path.join(dir, "definitely-absent.txt")],
      { encoding: "utf8" },
    );
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/could not read/i);
  });

  it("refuses when given no argument at all", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
  });
});
