/**
 * #1557 — a job killed by its own `timeout-minutes` must reach the rolling
 * issue, exactly like a job that failed.
 *
 * WHY THIS EXISTS. GitHub concludes a job that hits its `timeout-minutes` as
 * `cancelled`, not `failure`. Every rolling-issue reporter here was gated on
 * `if: failure()` (or on the measuring job's outputs), so a timed-out job made
 * the reporter SKIP: mutation.yml's ts-mutants died at its 300-minute bound on
 * 2026-10-05 and 2026-10-12 and nothing was filed until gate-liveness noticed
 * on day 17. The semantics were measured on a probe workflow rather than
 * assumed: after a job timeout, `needs.<job>.result` is `cancelled`,
 * `failure()` is false, and `cancelled()` is false — `cancelled()` is true only
 * when the RUN was cancelled (by hand or by a concurrency group). So the
 * reporter condition this pins is "a need failed or was cancelled, and the run
 * itself was not".
 *
 * What is pinned, for every reporter job (one holding `issues: write` that runs
 * `gh issue create|comment|edit`) in every workflow declaring
 * `# on-failure: rolling-issue`:
 *
 *   1. its `if:` is TRUE when any one need is `cancelled` or `failure` and the
 *      run was not cancelled — evaluated, not pattern-matched, by the small
 *      expression evaluator below, so an equivalent spelling also passes;
 *   2. its `if:` is FALSE when every need succeeded with empty outputs, and when
 *      the run itself was cancelled — the reporter must not cry wolf;
 *   3. its script, run under bash with a stub `gh` and that need set to
 *      `cancelled`, actually opens or updates the issue with a non-empty body
 *      that says the job timed out — an `if:` that fires into a script that
 *      exits "nothing to report" would be the same silence one level down.
 *
 * @coordinates-with .github/workflows/mutation.yml
 * @coordinates-with .github/workflows/gate-liveness.yml
 * @coordinates-with scripts/check-gate-liveness.mjs
 * @module scripts/check-rolling-issue-timeouts.test
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "yaml";

const REPO = path.resolve(import.meta.dirname, "..");
const WF_DIR = path.join(REPO, ".github/workflows");

// ---------------------------------------------------------------------------
// A GitHub Actions expression evaluator, limited to what `if:` here uses:
// `!`, `&&`, `||`, `==`, `!=`, parentheses, string/boolean literals, the status
// functions, `contains`, and `needs.<job>.<field>` / `needs.*.result` paths.
// Anything else throws, so an unsupported construct fails loudly instead of
// evaluating to something plausible.
// ---------------------------------------------------------------------------
const STATUS_FNS = new Set(["success", "failure", "cancelled", "always"]);

function tokenize(raw) {
  const src = raw.trim();
  const re = /\s*(&&|\|\||==|!=|!|\(|\)|,|\.|\*|\[|\]|'(?:[^']|'')*'|[A-Za-z_][\w-]*)/y;
  const out = [];
  let at = 0;
  while (at < src.length) {
    const m = re.exec(src);
    if (!m) throw new Error(`cannot tokenize: ${src.slice(at)}`);
    out.push(m[1]);
    at = re.lastIndex;
  }
  return out;
}

function evaluate(raw, ctx) {
  const src = String(raw).trim().replace(/^\$\{\{([\s\S]*)\}\}$/, "$1");
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i];
  const take = (t) => {
    if (t !== undefined && tokens[i] !== t) throw new Error(`expected ${t} at ${tokens[i]} in ${src}`);
    return tokens[i++];
  };
  const results = () => Object.values(ctx.needs).map((n) => n.result);
  const call = (name, args) => {
    if (name === "success") return !ctx.runCancelled && results().every((r) => r === "success");
    if (name === "failure") return results().includes("failure");
    if (name === "cancelled") return ctx.runCancelled;
    if (name === "always") return true;
    if (name === "contains") {
      const [hay, needle] = args;
      return Array.isArray(hay) ? hay.includes(needle) : String(hay ?? "").includes(String(needle));
    }
    throw new Error(`unsupported function ${name}()`);
  };
  const primary = () => {
    const t = take();
    if (t === "(") {
      const v = or();
      take(")");
      return v;
    }
    if (t === "!") return !truthy(primary());
    if (t.startsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
    if (t === "true" || t === "false") return t === "true";
    if (peek() === "(") {
      take("(");
      const args = [];
      while (peek() !== ")") {
        args.push(or());
        if (peek() === ",") take(",");
      }
      take(")");
      return call(t, args);
    }
    if (t !== "needs") throw new Error(`unsupported context ${t} in ${src}`);
    let value = ctx.needs;
    let star = false;
    while (peek() === "." || peek() === "[") {
      let key;
      if (take() === "[") {
        key = take().slice(1, -1);
        take("]");
      } else key = take();
      if (key === "*") star = true;
      else value = star ? Object.values(value).map((v) => v?.[key]) : value?.[key];
    }
    return value ?? "";
  };
  const truthy = (v) => (Array.isArray(v) ? true : Boolean(v));
  const cmp = () => {
    const left = primary();
    if (peek() === "==" || peek() === "!=") {
      const op = take();
      const right = primary();
      return op === "==" ? String(left) === String(right) : String(left) !== String(right);
    }
    return left;
  };
  const and = () => {
    let v = cmp();
    while (peek() === "&&") {
      take();
      const r = cmp();
      v = truthy(v) && truthy(r);
    }
    return v;
  };
  const or = () => {
    let v = and();
    while (peek() === "||") {
      take();
      const r = and();
      v = truthy(v) || truthy(r);
    }
    return v;
  };
  const value = truthy(or());
  if (i !== tokens.length) throw new Error(`trailing tokens in ${src}: ${tokens.slice(i).join(" ")}`);
  // GitHub prepends `success() &&` when no status function appears.
  const hasStatus = tokens.some((t, k) => STATUS_FNS.has(t) && tokens[k + 1] === "(");
  return hasStatus ? value : call("success", []) && value;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
const declaring = readdirSync(WF_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .filter((f) => /^\s*#\s*on-failure:\s*rolling-issue\s*$/m.test(readFileSync(path.join(WF_DIR, f), "utf8")));

const reporters = declaring.flatMap((file) => {
  const { jobs } = parse(readFileSync(path.join(WF_DIR, file), "utf8"));
  return Object.entries(jobs)
    .filter(
      ([, job]) =>
        job.permissions?.issues === "write" &&
        (job.steps ?? []).some((s) => /gh issue (create|comment|edit)/.test(String(s.run ?? ""))),
    )
    .map(([id, job]) => ({ file, id, job, needs: [job.needs ?? []].flat() }));
});

const ctxWith = (needs, override, { runCancelled = false } = {}) => ({
  runCancelled,
  needs: Object.fromEntries(
    needs.map((n) => [n, { result: n === override?.job ? override.result : "success", outputs: {} }]),
  ),
});

describe("the evaluator agrees with GitHub on the cases measured", () => {
  // Probe run 38735983965: job timeout → result cancelled, failure() false.
  const timedOut = ctxWith(["a"], { job: "a", result: "cancelled" });
  it("a bare failure() skips a timed-out need — the #1557 defect", () => {
    expect(evaluate("failure()", timedOut)).toBe(false);
  });
  it("cancelled() is false when only a job timed out", () => {
    expect(evaluate("cancelled()", timedOut)).toBe(false);
  });
  it("no status function means success() is implied", () => {
    expect(evaluate("needs.a.outputs.x == ''", timedOut)).toBe(false);
  });
  it("refuses a construct it does not model", () => {
    expect(() => evaluate("github.event_name == 'push'", timedOut)).toThrow(/unsupported/);
  });
});

describe("every rolling-issue reporter fires on a timed-out need", () => {
  it("finds the reporters", () => {
    expect(declaring).toContain("mutation.yml");
    expect(reporters.map((r) => `${r.file}:${r.id}`)).toContain("mutation.yml:report");
    expect(reporters.length).toBeGreaterThanOrEqual(declaring.length);
  });

  const cases = reporters.flatMap((r) => r.needs.map((need) => [`${r.file} ${r.id} ← ${need}`, r, need]));

  it.each(cases)("%s: `if:` is true for cancelled and failure, false otherwise", (_label, r, need) => {
    expect(r.needs.length, `${r.file}:${r.id} has no needs`).toBeGreaterThan(0);
    const cond = r.job.if ?? "success()";
    for (const result of ["cancelled", "failure"]) {
      expect(evaluate(cond, ctxWith(r.needs, { job: need, result })), `${result}: ${cond}`).toBe(true);
    }
    expect(evaluate(cond, ctxWith(r.needs)), `all green: ${cond}`).toBe(false);
    const runCancelled = ctxWith(r.needs, { job: need, result: "cancelled" }, { runCancelled: true });
    expect(evaluate(cond, runCancelled), `run cancelled: ${cond}`).toBe(false);
  });

  it.each(cases)("%s: the script files an issue saying it timed out", (_label, r, need) => {
    const dir = mkdtempSync(path.join(tmpdir(), "rolling-issue-"));
    const log = path.join(dir, "gh.log");
    writeFileSync(
      path.join(dir, "gh"),
      `#!/usr/bin/env bash\nfor a in "$@"; do printf '%s\\x1f' "$a"; done >> "${log}"\nprintf '\\x1e' >> "${log}"\n`,
    );
    chmodSync(path.join(dir, "gh"), 0o755);
    for (const step of r.job.steps.filter((s) => s.run)) {
      expect(step.run, "expressions belong in env:, not in the script").not.toMatch(/\$\{\{/);
      const env = { PATH: `${dir}:${process.env.PATH}`, GITHUB_SHA: "0123abc" };
      for (const [k, v] of Object.entries(step.env ?? {})) {
        const m = String(v).match(/^\$\{\{\s*needs(?:\.([\w-]+)|\['([\w-]+)'\])\.result\s*\}\}$/);
        if (m) env[k] = (m[1] ?? m[2]) === need ? "cancelled" : "success";
        else if (/needs\./.test(String(v))) env[k] = "";
        else env[k] = "placeholder";
      }
      const res = spawnSync("bash", ["-eo", "pipefail", "-c", step.run], { env, encoding: "utf8" });
      expect(res.status, res.stdout + res.stderr).toBe(0);
    }
    const calls = readFileSync(log, "utf8").split("\x1e").filter(Boolean).map((c) => c.split("\x1f").slice(0, -1));
    const filing = calls.find((c) => c[0] === "issue" && ["create", "comment", "edit"].includes(c[1]));
    expect(filing, `no issue filed; gh calls: ${JSON.stringify(calls)}`).toBeDefined();
    const body = filing[filing.indexOf("--body") + 1] ?? "";
    expect(body).toMatch(/timed out|timeout-minutes/);
  });
});
