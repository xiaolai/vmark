/**
 * The journal-refusal contract every journaled mutation advertises.
 *
 * `document.write`, `selection.set` and `workflow.apply_patch` all run the
 * app's controlled-mutation protocol, so each can be refused with every code the app's journal error
 * mapping answers. Their descriptions used to carry two hand-written copies of
 * that list, and the copy on `selection` had already lost
 * REVIEW_BACKLOG_FULL. Now one list is the source: this test pins it to the
 * codes the app actually answers, and each description to the list.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { VMarkMcpServer } from '../../../src/server.js';
import { registerDocumentTool } from '../../../src/tools/document.js';
import { JOURNAL_REFUSAL_CODES, JOURNAL_REFUSALS } from '../../../src/tools/journalRefusals.js';
import { registerSelectionTool } from '../../../src/tools/selection.js';
import { registerWorkflowTool } from '../../../src/tools/workflow.js';
import { MockBridge } from '../../mocks/mockBridge.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const APP_JOURNAL_ERRORS = resolve(REPO, 'src/services/mcpBridge/v2/journalV2Error.ts');
const APP_JOURNAL_CODES = resolve(REPO, 'src/services/agentJournal/journalRefusal.ts');
const APP_JOURNAL_CLIENT = resolve(REPO, 'src/services/agentJournal/journalClient.ts');

/**
 * The slice of the TypeScript compiler API these readers use. It is the app's
 * compiler (the repo root's), not this package's: the sidecar's TypeScript
 * ships no JavaScript parser API.
 */
interface TsNode { readonly kind: number }
interface TsApi {
  ScriptTarget: { Latest: number };
  createSourceFile(name: string, text: string, target: number, setParents: boolean): TsNode;
  forEachChild(node: TsNode, visit: (child: TsNode) => void): void;
  isVariableDeclaration(n: TsNode): n is TsNode & { name: TsNode; initializer?: TsNode };
  isTypeAliasDeclaration(n: TsNode): n is TsNode & { name: TsNode; type: TsNode };
  isIdentifier(n: TsNode): n is TsNode & { text: string };
  isAsExpression(n: TsNode): n is TsNode & { expression: TsNode };
  isArrayLiteralExpression(n: TsNode): n is TsNode & { elements: readonly TsNode[] };
  isUnionTypeNode(n: TsNode): n is TsNode & { types: readonly TsNode[] };
  isLiteralTypeNode(n: TsNode): n is TsNode & { literal: TsNode };
  isStringLiteral(n: TsNode): n is TsNode & { text: string };
}
const ts = createRequire(resolve(REPO, 'package.json'))('typescript') as TsApi;

/** The first declaration in `source` that `pick` accepts, searched depth-first. */
function findNode<T extends TsNode>(source: string, pick: (n: TsNode) => T | undefined, what: string): T {
  let found: T | undefined;
  const visit = (n: TsNode): void => {
    found ??= pick(n);
    if (!found) ts.forEachChild(n, visit);
  };
  visit(ts.createSourceFile('app.ts', source, ts.ScriptTarget.Latest, true));
  if (!found) throw new Error(`${what} not found`);
  return found;
}

/** The string literals as parsed — a commented-out member is not a member. */
function stringsOf(nodes: readonly TsNode[], what: string): string[] {
  return nodes.map((n) => {
    if (!ts.isStringLiteral(n)) throw new Error(`${what} holds a member that is not a string literal`);
    return n.text;
  });
}

/** The elements of the app's `JOURNAL_CODES` array: every token a journal command can refuse with. */
function appJournalCodes(source: string): string[] {
  const decl = findNode(source, (n) => (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'JOURNAL_CODES' ? n : undefined), 'JOURNAL_CODES');
  let init = decl.initializer;
  while (init && ts.isAsExpression(init)) init = init.expression;
  if (!init || !ts.isArrayLiteralExpression(init)) throw new Error('JOURNAL_CODES is not an array literal');
  return stringsOf(init.elements, 'JOURNAL_CODES');
}

/** The members of the app's `AbortReason` union. */
function appAbortReasons(source: string = readFileSync(APP_JOURNAL_CLIENT, 'utf8')): string[] {
  const alias = findNode(source, (n) => (ts.isTypeAliasDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'AbortReason' ? n : undefined), 'AbortReason');
  if (!ts.isUnionTypeNode(alias.type)) throw new Error('AbortReason is not a union');
  return stringsOf(alias.type.types.map((t) => (ts.isLiteralTypeNode(t) ? t.literal : t)), 'AbortReason').sort();
}

interface V2Answer { error: string; message: string }
interface JournalV2ErrorModule {
  invalidTextError(): V2Answer;
  invalidAddressesError(why: string): V2Answer;
  journalRefusalError(refusal: { journalCode: string; message: string }): V2Answer;
  abortedError(reason: string): V2Answer;
  appliedWithErrorError(error: unknown, durable: boolean, revision: string): V2Answer;
  recoveryRequiredError(error: unknown): V2Answer;
}
const ERROR_BUILDERS = ['abortedError', 'appliedWithErrorError', 'invalidAddressesError', 'invalidTextError', 'journalRefusalError', 'recoveryRequiredError'];

/**
 * The app's journal error mapping, RUN: `source` is written to its own file
 * and imported. Its imports are type-only, so it loads without the app.
 */
const LOAD_DIR = mkdtempSync(join(tmpdir(), 'journal-v2-error-'));
afterAll(() => rmSync(LOAD_DIR, { recursive: true, force: true }));
let loads = 0;
async function loadMapping(source: string): Promise<JournalV2ErrorModule> {
  const file = join(LOAD_DIR, `journalV2Error.${(loads += 1)}.ts`);
  writeFileSync(file, source);
  const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
  const builders = Object.keys(mod).filter((k) => typeof mod[k] === 'function').sort();
  // A new answer builder must be added below, or its codes would go unread.
  expect(builders).toEqual(ERROR_BUILDERS);
  return mod as unknown as JournalV2ErrorModule;
}

interface AppTexts { errors: string; refusals: string }

/**
 * Every code the app's journal error mapping answers, minus the defect answer
 * INTERNAL: each answer builder is called over its whole input domain (every
 * journal code, every abort reason). What the mapping executes is what
 * counts, so a commented-out or dead `error: "CODE"` names nothing.
 */
async function appRefusalCodes(texts: Partial<AppTexts> = {}): Promise<string[]> {
  const m = await loadMapping(texts.errors ?? readFileSync(APP_JOURNAL_ERRORS, 'utf8'));
  const answers = [
    m.invalidTextError(),
    m.invalidAddressesError('m'),
    ...appJournalCodes(texts.refusals ?? readFileSync(APP_JOURNAL_CODES, 'utf8')).map((journalCode) => m.journalRefusalError({ journalCode, message: 'm' })),
    ...appAbortReasons().map((reason) => m.abortedError(reason)),
    m.appliedWithErrorError(new Error('e'), true, 'r'),
    m.recoveryRequiredError(new Error('e')),
  ];
  const codes = new Set(answers.map((a) => a.error));
  codes.delete('INTERNAL');
  return [...codes].sort();
}

function descriptionOf(register: (s: VMarkMcpServer) => void, name: string): string {
  const server = new VMarkMcpServer({ bridge: new MockBridge() });
  register(server);
  const tool = server.listTools().find((t) => t.name === name);
  if (!tool) throw new Error(`${name} is not registered`);
  return tool.description;
}

const realText = (path: string): string => readFileSync(path, 'utf8');

/** `text` with `from` replaced; asserts the edit changed something. */
function mutated(text: string, from: string | RegExp, to: string): string {
  const next = text.replace(from, to);
  expect(next).not.toBe(text);
  return next;
}

describe('journal refusals', () => {
  it('the list is exactly the codes the app answers for a refused or aborted journaled write', async () => {
    const codes = await appRefusalCodes();
    expect(codes.length).toBeGreaterThan(0);
    expect([...JOURNAL_REFUSAL_CODES].sort()).toEqual(codes);
  });

  it('the description fragment names every code', () => {
    for (const code of JOURNAL_REFUSAL_CODES) expect(JOURNAL_REFUSALS).toContain(code);
  });

  it('the description fragment names every abort reason the app can answer', async () => {
    const reasons = appAbortReasons();
    expect(reasons.length).toBeGreaterThan(0);
    const mapping = await loadMapping(realText(APP_JOURNAL_ERRORS));
    for (const reason of reasons) expect(mapping.abortedError(reason).message, `no message for ${reason}`).toEqual(expect.any(String));
    const listed = /ABORTED with `reason` ([\w/]+)/.exec(JOURNAL_REFUSALS)?.[1].split('/').sort();
    expect(listed).toEqual(reasons);
  });

  it.each([
    ['document', registerDocumentTool],
    ['selection', registerSelectionTool],
    ['workflow', registerWorkflowTool],
  ] as const)('the %s tool advertises every journal refusal', (name, register) => {
    const description = descriptionOf(register, name);
    for (const code of JOURNAL_REFUSAL_CODES) expect(description, `${name} omits ${code}`).toContain(code);
    expect(description).toContain(JOURNAL_REFUSALS);
  });
});

describe('the app codes are read from what the mapping executes, not from its text', () => {
  const backlog = / {2}REVIEW_BACKLOG_FULL: \{\n {4}error: "REVIEW_BACKLOG_FULL",\n {4}message: "[^"]*",\n {2}\},\n/;

  it('a refusal whose mapping is commented out is not answered, though the comment still names it', async () => {
    const errors = mutated(realText(APP_JOURNAL_ERRORS), backlog, '  // REVIEW_BACKLOG_FULL: { error: "REVIEW_BACKLOG_FULL", message: "gone" },\n');
    expect(await appRefusalCodes({ errors })).not.toContain('REVIEW_BACKLOG_FULL');
  });

  it('a refusal left only in a dead constant or a string is not answered', async () => {
    const errors = mutated(realText(APP_JOURNAL_ERRORS), backlog, '').concat(
      '\nconst RETIRED: V2Error = { error: "REVIEW_BACKLOG_FULL", message: "retired" };\n',
      'const NOTE = \'error: "REVIEW_BACKLOG_FULL"\';\n',
    );
    expect(await appRefusalCodes({ errors })).not.toContain('REVIEW_BACKLOG_FULL');
  });

  it('a journal code commented out of the app\'s code list can no longer be answered', async () => {
    const refusals = mutated(realText(APP_JOURNAL_CODES), '  "REVIEW_BACKLOG_FULL",\n', '  // "REVIEW_BACKLOG_FULL",\n');
    expect(await appRefusalCodes({ refusals })).not.toContain('REVIEW_BACKLOG_FULL');
  });

  it('a newly mapped refusal is answered, so the list must grow with it', async () => {
    const errors = mutated(realText(APP_JOURNAL_ERRORS), '  INVALID_TEXT,\n', '  INVALID_TEXT,\n  STALE_REVIEW: { error: "STALE_REVIEW", message: "stale" },\n');
    expect(await appRefusalCodes({ errors })).toContain('STALE_REVIEW');
  });

  it('an abort reason whose message is commented out has no answer', async () => {
    const errors = mutated(realText(APP_JOURNAL_ERRORS), /\n {2}applyRefused: "/, '\n  // applyRefused: "');
    expect((await loadMapping(errors)).abortedError('applyRefused').message).toBeUndefined();
  });
});
