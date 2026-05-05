// WI-1.3 — jobs subparser.
//
// Translates the `jobs:` mapping into JobIR[]. Step parsing is delegated
// to ./steps.ts; matrix to ./matrix.ts; permissions to ./permissions.ts.
// Each job is parsed independently; failures in one don't abort others.

import type { MappingToken } from "@actions/workflow-parser/templates/tokens/mapping-token";
import type { TemplateToken } from "@actions/workflow-parser/templates/tokens/template-token";
import type {
  ConcurrencyIR,
  ContainerIR,
  Diagnostic,
  JobEnvironmentIR,
  JobIR,
  StrategyIR,
} from "../types";
import {
  asMapping,
  asSequence,
  getBoolean,
  getBooleanOrExpression,
  getMapping,
  getNumber,
  getRecord,
  getString,
  getStringArray,
  mappingEntries,
  rangeOrZero,
} from "./tokens";
import { parseMatrix } from "./matrix";
import { parsePermissions } from "./permissions";
import { parseSteps } from "./steps";

export interface ParseJobsResult {
  jobs: JobIR[];
  diagnostics: Diagnostic[];
}

export function parseJobs(jobsToken: TemplateToken | undefined): ParseJobsResult {
  const out: JobIR[] = [];
  const diagnostics: Diagnostic[] = [];

  const map = asMapping(jobsToken);
  if (!map) return { jobs: out, diagnostics };

  const seenIds = new Set<string>();
  for (const [jobId, jobBody] of mappingEntries(map)) {
    if (seenIds.has(jobId)) {
      diagnostics.push({
        severity: "error",
        code: "GHA-JOB-001",
        message: `Duplicate job id "${jobId}".`,
        position: rangeOrZero(jobBody),
        context: { jobId },
      });
      continue;
    }
    seenIds.add(jobId);

    const jobMap = asMapping(jobBody);
    if (!jobMap) continue;

    const job = buildJob(jobId, jobBody, jobMap, diagnostics);
    out.push(job);
  }

  return { jobs: out, diagnostics };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function buildJob(
  jobId: string,
  jobBody: TemplateToken,
  jobMap: MappingToken,
  diagnostics: Diagnostic[],
): JobIR {
  const uses = getString(jobMap, "uses");
  const stepsResult = parseSteps(jobMap.find("steps"), jobId);
  diagnostics.push(...stepsResult.diagnostics);

  if (uses && stepsResult.steps.length > 0) {
    diagnostics.push({
      severity: "error",
      code: "GHA-JOB-002",
      message: `Job "${jobId}" cannot have both uses: and steps:.`,
      position: rangeOrZero(jobBody),
      context: { jobId },
    });
  }

  const job: JobIR = {
    id: jobId,
    needs: getStringArray(jobMap, "needs") ?? [],
    steps: uses ? [] : stepsResult.steps,
    position: rangeOrZero(jobBody),
  };

  if (uses) job.uses = uses;
  applyOptionalScalars(jobMap, job);
  applyOptionalRecords(jobMap, job);
  applyComplexOptionals(jobMap, job, diagnostics);
  applySecrets(jobMap, job);

  return job;
}

function applyOptionalScalars(jobMap: MappingToken, job: JobIR): void {
  const runsOn = getStringArray(jobMap, "runs-on");
  if (runsOn) job.runsOn = runsOn;
  const ifExpr = getString(jobMap, "if");
  if (ifExpr !== undefined) job.if = ifExpr;
  const timeoutMinutes = getNumber(jobMap, "timeout-minutes");
  if (timeoutMinutes !== undefined) job.timeoutMinutes = timeoutMinutes;
  const continueOnError = getBoolean(jobMap, "continue-on-error");
  if (continueOnError !== undefined) job.continueOnError = continueOnError;
}

function applyOptionalRecords(jobMap: MappingToken, job: JobIR): void {
  const env = getRecord(jobMap, "env");
  if (env) job.env = env;
  const outputs = getRecord(jobMap, "outputs");
  if (outputs) job.outputs = outputs;
  const withRecord = getRecord(jobMap, "with");
  if (withRecord) job.with = withRecord;
}

function applyComplexOptionals(
  jobMap: MappingToken,
  job: JobIR,
  diagnostics: Diagnostic[],
): void {
  const defaults = parseDefaults(jobMap);
  if (defaults) job.defaults = defaults;
  const permissions = parsePermissionsBlock(jobMap);
  if (permissions !== undefined) job.permissions = permissions;
  const environment = parseEnvironment(jobMap);
  if (environment) job.environment = environment;
  const concurrency = parseConcurrency(jobMap);
  if (concurrency) job.concurrency = concurrency;
  const strategy = parseStrategy(jobMap, diagnostics);
  if (strategy) job.strategy = strategy;
  const container = parseContainer(jobMap.find("container"));
  if (container) job.container = container;
  const services = parseServices(jobMap);
  if (services) job.services = services;
}

function applySecrets(jobMap: MappingToken, job: JobIR): void {
  const secretsRaw = jobMap.find("secrets");
  if (!secretsRaw) return;
  const literal = (secretsRaw as TemplateToken & { value?: unknown }).value;
  if (literal === "inherit") {
    job.secrets = "inherit";
    return;
  }
  const secretsMap = getRecord(jobMap, "secrets");
  if (secretsMap) job.secrets = secretsMap;
}

function parseDefaults(map: MappingToken): JobIR["defaults"] | undefined {
  const defaults = getMapping(map, "defaults");
  if (!defaults) return undefined;
  const run = getMapping(defaults, "run");
  if (!run) return {};
  const out: JobIR["defaults"] = { run: {} };
  const shell = getString(run, "shell");
  if (shell) out.run!.shell = shell;
  const wd = getString(run, "working-directory");
  if (wd) out.run!.workingDirectory = wd;
  return out;
}

function parsePermissionsBlock(
  map: MappingToken,
): JobIR["permissions"] | undefined {
  const tok = map.find("permissions");
  if (!tok) return undefined;
  const literal = (tok as TemplateToken & { value?: unknown }).value;
  if (literal === "read-all" || literal === "write-all" || literal === "none") {
    return literal;
  }
  const inner = asMapping(tok);
  if (!inner) return undefined;
  const raw: Record<string, unknown> = {};
  for (let i = 0; i < inner.count; i++) {
    const pair = inner.get(i);
    const k = (pair.key as TemplateToken & { value?: unknown }).value;
    const v = (pair.value as TemplateToken & { value?: unknown }).value;
    if (typeof k === "string") raw[k] = v;
  }
  return parsePermissions(raw).value;
}

function parseEnvironment(map: MappingToken): JobEnvironmentIR | undefined {
  const tok = map.find("environment");
  if (!tok) return undefined;
  const literal = (tok as TemplateToken & { value?: unknown }).value;
  if (typeof literal === "string") return { name: literal };
  const inner = asMapping(tok);
  if (!inner) return undefined;
  const name = getString(inner, "name");
  if (!name) return undefined;
  const url = getString(inner, "url");
  return url ? { name, url } : { name };
}

function parseConcurrency(map: MappingToken): ConcurrencyIR | undefined {
  const tok = map.find("concurrency");
  if (!tok) return undefined;
  const literal = (tok as TemplateToken & { value?: unknown }).value;
  if (typeof literal === "string") return { group: literal };
  const inner = asMapping(tok);
  if (!inner) return undefined;
  const group = getString(inner, "group");
  if (!group) return undefined;
  // Expression form (`${{ … }}`) is valid per GitHub Actions and the
  // ConcurrencyIR allows it; getBoolean dropped it silently (auditor).
  const cancelInProgress = getBooleanOrExpression(
    inner,
    "cancel-in-progress",
  );
  return cancelInProgress !== undefined
    ? { group, cancelInProgress }
    : { group };
}

function parseStrategy(
  map: MappingToken,
  diagnostics: Diagnostic[],
): StrategyIR | undefined {
  const strategy = getMapping(map, "strategy");
  if (!strategy) return undefined;
  const out: StrategyIR = {};
  const failFast = getBoolean(strategy, "fail-fast");
  if (failFast !== undefined) out.failFast = failFast;
  const maxParallel = getNumber(strategy, "max-parallel");
  if (maxParallel !== undefined) out.maxParallel = maxParallel;
  const matrixTok = strategy.find("matrix");
  if (matrixTok) {
    const raw = tokenToPlainObject(matrixTok);
    const parsed = parseMatrix(raw);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.value) out.matrix = parsed.value;
  }
  return Object.keys(out).length ? out : undefined;
}

function parseContainer(tok: TemplateToken | undefined): ContainerIR | undefined {
  if (!tok) return undefined;
  const literal = (tok as TemplateToken & { value?: unknown }).value;
  if (typeof literal === "string") return { image: literal };
  const inner = asMapping(tok);
  if (!inner) return undefined;
  const image = getString(inner, "image");
  if (!image) return undefined;
  const out: ContainerIR = { image };
  const env = getRecord(inner, "env");
  if (env) out.env = env;

  const portsTok = inner.find("ports");
  const portsSeq = asSequence(portsTok);
  if (portsSeq) {
    const ports: (string | number)[] = [];
    for (let i = 0; i < portsSeq.count; i++) {
      const v = (portsSeq.get(i) as TemplateToken & { value?: unknown }).value;
      if (typeof v === "string" || typeof v === "number") ports.push(v);
    }
    if (ports.length) out.ports = ports;
  }

  const volumes = getStringArray(inner, "volumes");
  if (volumes) out.volumes = volumes;
  const options = getString(inner, "options");
  if (options) out.options = options;
  const credsMap = getMapping(inner, "credentials");
  if (credsMap) {
    const username = getString(credsMap, "username");
    const password = getString(credsMap, "password");
    if (username || password) {
      out.credentials = {
        ...(username ? { username } : {}),
        ...(password ? { password } : {}),
      };
    }
  }
  return out;
}

function parseServices(map: MappingToken): JobIR["services"] | undefined {
  const services = getMapping(map, "services");
  if (!services) return undefined;
  const out: NonNullable<JobIR["services"]> = {};
  for (const [name, body] of mappingEntries(services)) {
    const c = parseContainer(body);
    if (c) out[name] = c;
  }
  return Object.keys(out).length ? out : undefined;
}

function tokenToPlainObject(t: TemplateToken): unknown {
  const scalar = (t as TemplateToken & { value?: unknown }).value;
  if (scalar !== undefined) return scalar;
  const map = asMapping(t);
  if (map) {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < map.count; i++) {
      const pair = map.get(i);
      const k = (pair.key as TemplateToken & { value?: unknown }).value;
      if (typeof k === "string") obj[k] = tokenToPlainObject(pair.value);
    }
    return obj;
  }
  const seq = asSequence(t);
  if (seq) {
    const arr: unknown[] = [];
    for (let i = 0; i < seq.count; i++) arr.push(tokenToPlainObject(seq.get(i)));
    return arr;
  }
  return undefined;
}
