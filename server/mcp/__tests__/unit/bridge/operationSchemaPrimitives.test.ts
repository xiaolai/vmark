// Audit row #170 — the operation-schema primitives have ONE home and no cycle.
//
// `operationSchemas.ts` spreads the browser map into the full contract, so the
// browser module could not import `id`/`optionalTabId` back from it without a
// cycle — and re-spelled them locally instead. Two declarations of one wire
// spelling is the drift this directory exists to end. A copy PARSES identically
// to the original, so only object identity can tell "shared" from "duplicated":
// that is what the first test checks.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRIDGE_OPERATION_SCHEMAS } from '../../../src/bridge/operationSchemas.js';
import { BROWSER_OPERATION_SCHEMAS } from '../../../src/bridge/operationSchemas.browser.js';
import { id, optionalTabId } from '../../../src/bridge/operationSchemas.primitives.js';

const BRIDGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/bridge');
const source = (name: string): string => readFileSync(resolve(BRIDGE_DIR, name), 'utf8');

describe('operation schema primitives — one spelling', () => {
  it('both schema maps are built from the SAME primitive instances', () => {
    expect(BROWSER_OPERATION_SCHEMAS['vmark.browser.open'].shape.url).toBe(id);
    expect(BRIDGE_OPERATION_SCHEMAS['vmark.workspace.open'].shape.filePath).toBe(id);
    expect(BROWSER_OPERATION_SCHEMAS['vmark.browser.read'].shape.tabId).toBe(optionalTabId);
    expect(BRIDGE_OPERATION_SCHEMAS['vmark.document.read'].shape.tabId).toBe(optionalTabId);
  });

  it('means what the wire means', () => {
    expect(id.safeParse('tab-1').success).toBe(true);
    expect(id.safeParse(undefined).success).toBe(false);
    expect(id.safeParse(1).success).toBe(false);
    expect(optionalTabId.safeParse(undefined).success).toBe(true);
    expect(optionalTabId.safeParse('tab-1').success).toBe(true);
    expect(optionalTabId.safeParse(1).success).toBe(false);
  });
});

describe('operation schema primitives — no cycle', () => {
  it('the primitives module depends on zod alone', () => {
    const imports = [...source('operationSchemas.primitives.ts').matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['zod']);
  });

  it('both schema modules import the primitives instead of re-spelling them', () => {
    for (const file of ['operationSchemas.ts', 'operationSchemas.browser.ts']) {
      const text = source(file);
      expect(text, file).toContain("from './operationSchemas.primitives.js'");
      expect(text, file).not.toMatch(/^(export )?const (id|optionalTabId) = z\./m);
    }
  });
});
