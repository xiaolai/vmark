// @vitest-environment node
// Edge-branch coverage for the jobs subparser: literal-vs-mapping forms of
// permissions/environment/concurrency/container, secrets inherit, defaults
// without run, strategy scalars, container details, and degenerate tokens.
// Split from jobs.test.ts to keep suites focused.

import { describe, expect, it } from "vitest";
import { parseWorkflow } from "@actions/workflow-parser";
import { parseJobs } from "../jobs";
import { asMapping } from "../tokens";

const trace = { error: () => {}, info: () => {}, verbose: () => {} };

function getJobsToken(yaml: string) {
  const r = parseWorkflow({ name: "t.yml", content: yaml }, trace);
  const root = asMapping(r.value);
  if (!root) throw new Error("parse failed");
  return root.find("jobs");
}

function job(yaml: string) {
  const result = parseJobs(getJobsToken(yaml));
  return result.jobs[0];
}

const HEADER = "on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n";

describe("degenerate tokens", () => {
  it("returns empty for a missing/non-mapping jobs token", () => {
    expect(parseJobs(undefined)).toEqual({ jobs: [], diagnostics: [] });
  });

  it("skips a non-mapping job body", () => {
    const result = parseJobs(getJobsToken("on: push\njobs:\n  a: just-a-string"));
    expect(result.jobs).toEqual([]);
  });
});

describe("scalars", () => {
  it("parses timeout-minutes and continue-on-error", () => {
    const j = job(HEADER + "    timeout-minutes: 15\n    continue-on-error: true\n    steps: []\n");
    expect(j.timeoutMinutes).toBe(15);
    expect(j.continueOnError).toBe(true);
  });
});

describe("secrets (reusable-workflow jobs)", () => {
  it("parses the literal inherit form", () => {
    const j = job(
      "on: push\njobs:\n  a:\n    uses: org/repo/.github/workflows/x.yml@main\n    secrets: inherit\n"
    );
    expect(j.secrets).toBe("inherit");
  });

  it("parses the mapping form", () => {
    const j = job(
      "on: push\njobs:\n  a:\n    uses: org/repo/.github/workflows/x.yml@main\n    secrets:\n      TOKEN: abc\n"
    );
    expect(j.secrets).toEqual({ TOKEN: "abc" });
  });
});

describe("defaults", () => {
  it("defaults without run yields {}", () => {
    const j = job(HEADER + "    defaults: {}\n    steps: []\n");
    expect(j.defaults).toEqual({});
  });

  it("parses shell and working-directory", () => {
    const j = job(
      HEADER + "    defaults:\n      run:\n        shell: bash\n        working-directory: sub\n    steps: []\n"
    );
    expect(j.defaults).toEqual({ run: { shell: "bash", workingDirectory: "sub" } });
  });
});

describe("permissions", () => {
  it.each(["read-all", "write-all", "none"] as const)("parses the %s literal", (lit) => {
    const j = job(HEADER + `    permissions: ${lit}\n    steps: []\n`);
    expect(j.permissions).toBe(lit);
  });

  it("parses the mapping form", () => {
    const j = job(HEADER + "    permissions:\n      contents: read\n    steps: []\n");
    expect(j.permissions).toEqual(expect.objectContaining({ contents: "read" }));
  });
});

describe("environment", () => {
  it("parses the string literal form", () => {
    const j = job(HEADER + "    environment: prod\n    steps: []\n");
    expect(j.environment).toEqual({ name: "prod" });
  });

  it("parses name+url mapping and drops a nameless mapping", () => {
    const withUrl = job(
      HEADER + "    environment:\n      name: prod\n      url: https://x.example\n    steps: []\n"
    );
    expect(withUrl.environment).toEqual({ name: "prod", url: "https://x.example" });

    const nameless = job(HEADER + "    environment:\n      url: https://x.example\n    steps: []\n");
    expect(nameless.environment).toBeUndefined();
  });
});

describe("concurrency", () => {
  it("parses the string literal form", () => {
    const j = job(HEADER + "    concurrency: g1\n    steps: []\n");
    expect(j.concurrency).toEqual({ group: "g1" });
  });

  it("parses group + cancel-in-progress and drops a groupless mapping", () => {
    const full = job(
      HEADER + "    concurrency:\n      group: g1\n      cancel-in-progress: true\n    steps: []\n"
    );
    expect(full.concurrency).toEqual({ group: "g1", cancelInProgress: true });

    const groupless = job(HEADER + "    concurrency:\n      cancel-in-progress: true\n    steps: []\n");
    expect(groupless.concurrency).toBeUndefined();
  });
});

describe("strategy", () => {
  it("parses fail-fast and max-parallel without a matrix", () => {
    const j = job(HEADER + "    strategy:\n      fail-fast: false\n      max-parallel: 2\n    steps: []\n");
    expect(j.strategy).toEqual({ failFast: false, maxParallel: 2 });
  });

  it("an empty strategy mapping yields undefined", () => {
    const j = job(HEADER + "    strategy: {}\n    steps: []\n");
    expect(j.strategy).toBeUndefined();
  });
});

describe("container and services", () => {
  it("parses the string-image literal form", () => {
    const j = job(HEADER + "    container: node:22\n    steps: []\n");
    expect(j.container).toEqual({ image: "node:22" });
  });

  it("drops an imageless container mapping", () => {
    const j = job(HEADER + "    container:\n      env:\n        A: b\n    steps: []\n");
    expect(j.container).toBeUndefined();
  });

  it("parses env, ports, volumes, options, and partial credentials", () => {
    const j = job(
      HEADER +
        `    container:
      image: node:22
      env:
        A: b
      ports:
        - 8080
        - "9090:9090"
      volumes:
        - /data:/data
      options: --cpus 1
      credentials:
        username: u
    steps: []
`
    );
    expect(j.container).toEqual({
      image: "node:22",
      env: { A: "b" },
      ports: ["8080", "9090:9090"],
      volumes: ["/data:/data"],
      options: "--cpus 1",
      credentials: { username: "u" },
    });
  });

  it("parses services incl. the string-image shorthand", () => {
    const j = job(
      HEADER +
        `    services:
      db:
        image: postgres:16
      broken: just-a-string
    steps: []
`
    );
    expect(j.services).toEqual({
      db: { image: "postgres:16" },
      broken: { image: "just-a-string" },
    });
  });

  it("an empty services mapping yields undefined", () => {
    const j = job(HEADER + "    services: {}\n    steps: []\n");
    expect(j.services).toBeUndefined();
  });
});
