/**
 * An in-memory filesystem for the history tests.
 *
 * It models the three properties of the real one that the history code can get
 * wrong, and that a `Map` of resolved promises hides:
 *   - every call is asynchronous, so two operations interleave at each one;
 *   - a write is not atomic — the file is empty between the truncate and the
 *     data, for as long as `truncatedWindow` says;
 *   - directories are real: a write into a directory that has been removed
 *     fails, and a recursive remove takes everything under it.
 *
 * Shared by `vi.mock` factories (which import it lazily) and by the test body
 * (which seeds and inspects it), so both see one state.
 *
 * Files are held as the text that was written; `vfs.read` shows exactly that.
 * `readTextFile` returns what tauri-plugin-fs would: the text's UTF-8 bytes
 * through `new TextDecoder("utf-8")`, which drops a leading BOM and turns a
 * lone surrogate into U+FFFD (verified behaviour: src/test/statefulFsFake.ts).
 */

const files = new Map<string, string>();

const utf8 = new TextEncoder();

/** The text tauri-plugin-fs `readTextFile` returns for a file holding `text`. */
function asPluginReadsIt(text: string): string {
  return new TextDecoder("utf-8").decode(utf8.encode(text));
}
const dirs = new Set<string>();

interface PlannedFailure {
  op: "writeTextFile" | "readTextFile" | "remove" | "rename";
  pathSuffix: string;
  error: Error;
}

let plannedFailures: PlannedFailure[] = [];
let truncatedWindow = 0;
let duringTruncation: ((path: string) => void) | null = null;

/** Yield to other pending work `turns` times, without a timer. */
export async function yieldTurns(turns = 1): Promise<void> {
  for (let i = 0; i < turns; i += 1) await Promise.resolve();
}

function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

function addDirWithParents(path: string): void {
  let current = path;
  while (current && !dirs.has(current)) {
    dirs.add(current);
    current = parentOf(current);
  }
}

function takeFailure(op: PlannedFailure["op"], path: string): Error | null {
  const index = plannedFailures.findIndex((f) => f.op === op && path.endsWith(f.pathSuffix));
  if (index === -1) return null;
  const [failure] = plannedFailures.splice(index, 1);
  return failure!.error;
}

function notFound(path: string): Error {
  return new Error(`No such file or directory: ${path}`);
}

/** The controls the test body uses. */
export const vfs = {
  reset(): void {
    files.clear();
    dirs.clear();
    plannedFailures = [];
    truncatedWindow = 0;
    duringTruncation = null;
  },
  /** Put a file in place, creating its directories. */
  seed(path: string, content: string): void {
    addDirWithParents(parentOf(path));
    files.set(path, content);
  },
  read(path: string): string | undefined {
    return files.get(path);
  },
  has(path: string): boolean {
    return files.has(path) || dirs.has(path);
  },
  /** Names of the files directly inside `dir`, sorted. */
  filesIn(dir: string): string[] {
    const prefix = `${dir}/`;
    return [...files.keys()]
      .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
      .map((p) => p.slice(prefix.length))
      .sort();
  },
  /** Make the next matching call reject once. */
  failNext(op: PlannedFailure["op"], pathSuffix: string, error: Error): void {
    plannedFailures.push({ op, pathSuffix, error });
  },
  /**
   * Keep a file empty for `turns` yields in the middle of every write, and
   * call `onTruncated` at the start of that window.
   */
  setTruncatedWindow(turns: number, onTruncated: ((path: string) => void) | null = null): void {
    truncatedWindow = turns;
    duringTruncation = onTruncated;
  },
};

/** Stands in for `@tauri-apps/plugin-fs`. */
export const pluginFsMock = {
  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await yieldTurns();
    if (options?.recursive) addDirWithParents(path);
    else if (dirs.has(parentOf(path))) dirs.add(path);
    else throw notFound(parentOf(path));
  },
  async exists(path: string): Promise<boolean> {
    await yieldTurns();
    return files.has(path) || dirs.has(path);
  },
  async readTextFile(path: string): Promise<string> {
    await yieldTurns();
    const failure = takeFailure("readTextFile", path);
    if (failure) throw failure;
    const content = files.get(path);
    if (content === undefined) throw notFound(path);
    return asPluginReadsIt(content);
  },
  async writeTextFile(path: string, content: string): Promise<void> {
    await yieldTurns();
    const failure = takeFailure("writeTextFile", path);
    if (failure) throw failure;
    if (!dirs.has(parentOf(path))) throw notFound(parentOf(path));
    files.set(path, "");
    // Read before the callback runs: it may change the window for later writes.
    const turns = truncatedWindow;
    if (turns > 0) {
      duringTruncation?.(path);
      await yieldTurns(turns);
    }
    // Data written to a file whose directory was removed meanwhile goes to an
    // unlinked file: it does not bring the directory back.
    if (dirs.has(parentOf(path))) files.set(path, content);
  },
  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    await yieldTurns();
    const failure = takeFailure("remove", path);
    if (failure) throw failure;
    if (files.delete(path)) return;
    if (!dirs.has(path)) throw notFound(path);
    const prefix = `${path}/`;
    const hasChildren =
      [...files.keys()].some((p) => p.startsWith(prefix)) ||
      [...dirs].some((d) => d.startsWith(prefix));
    if (hasChildren && !options?.recursive) throw new Error(`Directory not empty: ${path}`);
    for (const p of [...files.keys()]) if (p.startsWith(prefix)) files.delete(p);
    for (const d of [...dirs]) if (d === path || d.startsWith(prefix)) dirs.delete(d);
  },
  /** Replaces `to` in one step, as `rename(2)` does: no reader sees it torn. */
  async rename(from: string, to: string): Promise<void> {
    await yieldTurns();
    const failure = takeFailure("rename", to);
    if (failure) throw failure;
    const content = files.get(from);
    if (content === undefined) throw notFound(from);
    if (!dirs.has(parentOf(to))) throw notFound(parentOf(to));
    files.delete(from);
    files.set(to, content);
  },
  async readDir(path: string): Promise<Array<{ name: string; isDirectory: boolean; isFile: boolean }>> {
    await yieldTurns();
    if (!dirs.has(path)) throw notFound(path);
    const prefix = `${path}/`;
    const direct = (p: string) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/");
    return [
      ...[...dirs].filter(direct).map((d) => ({
        name: d.slice(prefix.length),
        isDirectory: true,
        isFile: false,
      })),
      ...[...files.keys()].filter(direct).map((f) => ({
        name: f.slice(prefix.length),
        isDirectory: false,
        isFile: true,
      })),
    ];
  },
};

export const APP_DATA_DIR = "/app-data";

/** Stands in for `@tauri-apps/api/path`. */
export const pathApiMock = {
  async appDataDir(): Promise<string> {
    await yieldTurns();
    return APP_DATA_DIR;
  },
  async join(...parts: string[]): Promise<string> {
    await yieldTurns();
    return parts.join("/");
  },
};
