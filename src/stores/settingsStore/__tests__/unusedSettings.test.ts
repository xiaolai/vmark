// @vitest-environment node
/**
 * WI-FL0.7 — every settings leaf has a production READ site.
 *
 * A setting with a default, a type, a Settings row and ten translations — and
 * no consumer — is a promise the app cannot keep: the user flips it and
 * nothing happens (`appearance.autoHideStatusBar` shipped that way, D8). This
 * test enumerates every leaf of `initialState` and requires at least one read
 * of it in production source outside the settings store and the Settings
 * pages, which declare and WRITE settings rather than consume them.
 *
 * It detects UNUSED settings, not forwarded-and-ignored ones: a value that is
 * read and then dropped downstream (the old `mcpServer.port`, D9) has a read
 * site and passes here — those need an effect test against the consumer.
 *
 * MEASURED, not exempted: there is deliberately no allow-list. A key that
 * fails is either unwired (wire it) or dead (remove it WITH a migration so
 * persisted blobs are cleaned up — see `migrations.ts`). Three structural
 * read shapes are recognised; each was derived from the real idioms in `src/`:
 *
 *  1. `parent.leaf` — `s.general.autoSaveEnabled`, `getState().general.x`,
 *     `settings.general?.x`, and the chain broken across a line.
 *  2. The GROUP is read as an object and the leaf is then read off it or
 *     destructured — `const { scrollback } = getState().terminal`,
 *     `const m = getState().markdown; m.htmlAllowlistLevel`, and the CJK
 *     formatter's `config: CJKFormattingSettings` → `config.quoteStyle`.
 *  3. A META-SETTING inside the Settings pages: bound by a selector and used
 *     to GATE other content (`{devTools && <HotExitDevTools />}`). A row
 *     that only displays its own value (`checked={x.leaf}`) is not a read.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { initialState } from "../defaults";

const SRC = path.resolve(__dirname, "../../..");

type Source = { rel: string; text: string };

const NEVER_A_CONSUMER: RegExp[] = [
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /\.d\.ts$/,
  /(^|\/)__tests__\//,
  /(^|\/)__mocks__\//,
  /^test\//,
  /^bench\//,
  /^stores\/settingsStore(\/|\.ts$)/,
  /^stores\/settingsTypes(\/|\.ts$)/,
];
const SETTINGS_PAGES = /^pages\/settings\//;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Dotted leaf paths. An EMPTY object (`formats.associations`) is a leaf — a
 *  user-filled map — not a group with nothing under it. */
function leafPaths(node: unknown, prefix: string[] = []): string[][] {
  if (!isPlainObject(node) || Object.keys(node).length === 0) return [prefix];
  return Object.entries(node).flatMap(([k, v]) => leafPaths(v, [...prefix, k]));
}

function readSources(keep: (rel: string) => boolean): Source[] {
  return (fs.readdirSync(SRC, { recursive: true }) as string[])
    .filter((rel) => /\.tsx?$/.test(rel) && keep(rel))
    .sort()
    .map((rel) => ({ rel, text: fs.readFileSync(path.join(SRC, rel), "utf-8") }));
}

/** Shape 1: `parent.leaf`, tolerating `?.` and a line break in the chain. */
function readViaParent(segs: string[], text: string): boolean {
  const leaf = segs[segs.length - 1];
  const parent = segs.length > 1 ? segs[segs.length - 2] : null;
  const re = parent
    ? new RegExp(`\\b${parent}\\s*\\??\\.\\s*${leaf}\\b`)
    : new RegExp(`\\.\\s*${leaf}\\b`);
  return re.test(text);
}

/** Shape 2: the group is read as an object (`.terminal`, `hostSettings.cjkFormatting()`,
 *  or its `<Group>Settings` type) and the leaf is read off it or destructured. */
function readViaGroupObject(segs: string[], text: string): boolean {
  if (segs.length < 2) return false;
  const leaf = segs[segs.length - 1];
  const parent = segs[segs.length - 2];
  const groupRead =
    new RegExp(`\\.\\s*${parent}\\b`).test(text) ||
    new RegExp(`\\b${parent}Settings\\b`, "i").test(text);
  if (!groupRead) return false;
  return (
    new RegExp(`\\.\\s*${leaf}\\b`).test(text) ||
    new RegExp(`\\{[^}]*\\b${leaf}\\b[^}]*\\}\\s*=`).test(text)
  );
}

/** Shape 3 (Settings pages only): a selector binds the leaf to a variable that
 *  then GATES other content. Displaying its own value does not count. */
function gatesOtherSettingsContent(segs: string[], text: string): boolean {
  if (segs.length < 2) return false;
  const leaf = segs[segs.length - 1];
  const parent = segs[segs.length - 2];
  const bound = new RegExp(
    `const (\\w+) = useSettingsStore\\(\\s*\\(\\w+\\) =>\\s*\\w+\\.${parent}\\.${leaf}\\s*,?\\s*\\)`,
  ).exec(text);
  if (!bound) return false;
  return new RegExp(`\\{\\s*!?${bound[1]}\\s*(&&|\\?)`).test(text);
}

describe("every settings leaf is read somewhere in production (WI-FL0.7)", () => {
  const production = readSources(
    (rel) => !NEVER_A_CONSUMER.some((re) => re.test(rel)) && !SETTINGS_PAGES.test(rel),
  );
  const settingsPages = readSources(
    (rel) => !NEVER_A_CONSUMER.some((re) => re.test(rel)) && SETTINGS_PAGES.test(rel),
  );
  const leaves = leafPaths(initialState);
  const dotted = leaves.map((s) => s.join("."));

  it("scans a real corpus — an empty scan would pass vacuously", () => {
    expect(production.length).toBeGreaterThan(500);
    expect(settingsPages.length).toBeGreaterThan(10);
    expect(leaves.length).toBeGreaterThan(80);
    expect(dotted).toContain("general.autoSaveEnabled");
    expect(dotted).toContain("advanced.mcpServer.autoStart");
    expect(dotted).toContain("formats.associations");
    expect(dotted).toContain("showDevSection");
  });

  it("recognises each read shape on a minimal fixture and rejects a display-only row", () => {
    const segs = ["appearance", "someFlag"];
    expect(readViaParent(segs, "const on = s.appearance.someFlag;")).toBe(true);
    expect(readViaParent(segs, "getState().appearance\n  .someFlag ?? true")).toBe(true);
    expect(readViaGroupObject(segs, "const a = getState().appearance;\nif (a.someFlag) {}")).toBe(true);
    expect(readViaGroupObject(segs, "const { someFlag } =\n  getState().appearance;")).toBe(true);
    expect(readViaGroupObject(segs, "if (a.someFlag) {}")).toBe(false); // leaf without its group
    expect(
      gatesOtherSettingsContent(
        segs,
        "const dev = useSettingsStore((state) => state.appearance.someFlag);\n{dev && <X />}",
      ),
    ).toBe(true);
    expect(
      gatesOtherSettingsContent(segs, 'checked={appearance.someFlag ?? false} onChange={(v) => update("someFlag", v)}'),
    ).toBe(false);
  });

  it("finds a read site for every leaf", () => {
    const unread = leaves
      .filter(
        (segs) =>
          !production.some(({ text }) => readViaParent(segs, text) || readViaGroupObject(segs, text)) &&
          !settingsPages.some(({ text }) => gatesOtherSettingsContent(segs, text)),
      )
      .map((segs) => segs.join("."));
    expect(
      unread,
      `Settings with no production read site — wire it or remove it with a migration:\n  ${unread.join("\n  ")}`,
    ).toEqual([]);
  });
});
