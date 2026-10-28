/**
 * Stateful in-memory filesystem fake for the Tier-0 integration tier (WI-17).
 *
 * Purpose: let a test drive the REAL save / open / autosave / external-change
 * composition — real stores, real services — with `@tauri-apps/*` as the only
 * mocked boundary. Bytes written through the app's own write path come back
 * out of `readFile` (and, decoded, `readTextFile`), so an assertion can be
 * about the file, not about which function was called with what.
 *
 * Three contracts this fake exists to keep:
 *
 *   1. STATEFUL. `write(P, bytes)` → `read(P)` returns those bytes; mtime is
 *      settable and observable through `stat`. A choreography mock cannot
 *      distinguish "saved the right bytes" from "called the writer".
 *   2. NO SILENT SUCCESS. Every operation the fake does not model rejects (or
 *      throws, for a property access) with a message naming what was missing.
 *      `src/test/setup.ts` resolves `invoke` with `undefined` by default, so a
 *      flow that silently stopped writing still passed — the false-confidence
 *      class this tier exists to close. Reading an unknown path rejects like
 *      the real plugin does; an unstubbed command rejects by name.
 *   3. THE PLUGIN'S DECODING. Files are bytes. `readFile` returns them as
 *      they are; `readTextFile` decodes them as the plugin does, which DROPS a
 *      leading BOM. This fake used to hand `readTextFile` callers the BOM, and
 *      every jsdom BOM test passed on that difference while the real app lost
 *      the mark (statefulFsFake.plugin.test.ts pins the contract).
 *      Verified against the source of tauri-plugin-fs 2.x, the version
 *      `package.json` and `src-tauri/Cargo.toml` pin: the Rust commands
 *      `read_file` and `read_text_file` both call `read_file_inner`
 *      (`src/commands.rs`), which returns the file's raw bytes with no
 *      validation or BOM handling; in the guest JS (`guest-js/index.ts`),
 *      `readFile` returns those bytes as a `Uint8Array` and `readTextFile`
 *      returns `new TextDecoder(options?.encoding ?? 'utf-8').decode(bytes)`.
 *      Confirmed in the running app: `readFile` of a BOM'd file begins
 *      239, 187, 191 and `readTextFile` of it begins after them.
 *
 * Usage (the mock factory is lazy, so the dynamic import is safe):
 *
 *     vi.mock("@tauri-apps/plugin-fs", async () => {
 *       const { statefulFs } = await import("@/test/statefulFsFake");
 *       return statefulFs.fsModule();
 *     });
 *
 * @coordinates-with test/fakeDisk.ts — the in-memory disk this adapts to Tauri
 * @coordinates-with test/tier0/harness.ts — store reset + document seeding
 * @module test/statefulFsFake
 */
import { FakeDisk, fail, parentOf } from "./fakeDisk";

/** One write the APPLICATION performed, in order. */
interface WriteRecord {
  path: string;
  content: string;
  /** Which Tauri surface carried it — the save path uses `atomic_write_file`. */
  via: "atomic_write_file" | "writeTextFile";
}

/**
 * Names the module system itself probes. These must answer `undefined`
 * rather than throw — Vitest awaits the mock factory's result (`then`) and
 * the ESM/CJS interop layer reads `default`/`__esModule` — otherwise the
 * module cannot be loaded at all and the loud-fail contract never applies.
 */
const MODULE_INTEROP_KEYS = new Set([
  "then",
  "default",
  "__esModule",
  "$$typeof",
  "toJSON",
  "constructor",
  "prototype",
  "nodeType",
]);

/**
 * The fake. One instance is exported as `statefulFs`; call `reset()` in
 * `beforeEach` (the module registry is per test file, so there is no
 * cross-file bleed).
 */
class StatefulFsFake {
  private disk = new FakeDisk();
  private commands = new Map<string, (args: Record<string, unknown>) => unknown>();
  private writeFailure: ((path: string, content: string) => unknown) | null = null;

  /** Every application write, in submission order. */
  readonly writes: WriteRecord[] = [];

  reset(): void {
    this.disk.reset();
    this.commands.clear();
    this.writes.length = 0;
    this.writeFailure = null;
  }

  // ── Test-side state (synchronous; not part of the mocked surface) ──

  /** Put a file on the fake disk, creating its parent directories. */
  seed(path: string, content: string, opts?: { mtimeMs?: number }): void {
    this.disk.seed(path, content, opts);
  }

  /** Put raw bytes on the fake disk — e.g. a UTF-16 file, which no UTF-8 string describes. */
  seedBytes(path: string, bytes: Uint8Array, opts?: { mtimeMs?: number }): void {
    this.disk.seedBytes(path, bytes, opts);
  }

  /** Simulate an EXTERNAL writer (editor, git, cloud sync): new bytes, new mtime. */
  externalWrite(path: string, content: string, opts?: { mtimeMs?: number }): void {
    this.disk.seed(path, content, opts);
  }

  /** The file at `path` as text, every byte kept (a leading BOM included). Throws when absent. */
  read(path: string): string {
    return this.disk.read(path);
  }

  /** The raw bytes at `path`. Throws when absent. */
  readBytes(path: string): Uint8Array {
    return this.disk.readBytes(path);
  }

  has(path: string): boolean {
    return this.disk.has(path);
  }

  mtimeOf(path: string): number {
    return this.disk.mtimeOf(path);
  }

  setMtime(path: string, mtimeMs: number): void {
    this.disk.setMtime(path, mtimeMs);
  }

  /** Every path currently on the fake disk, sorted. */
  paths(): string[] {
    return this.disk.paths();
  }

  /** Application writes targeting `path`, in order. */
  writesTo(path: string): WriteRecord[] {
    return this.writes.filter((w) => w.path === path);
  }

  mkdirp(dir: string): void {
    this.disk.mkdirp(dir);
  }

  /** Make every write fail. `null` restores normal writes. */
  failWrites(error: unknown | null): void {
    this.writeFailure = error === null ? null : () => error;
  }

  /** Register an `invoke` command. Unregistered commands reject by name. */
  stubCommand(name: string, handler: (args: Record<string, unknown>) => unknown): void {
    this.commands.set(name, handler);
  }

  // ── Mocked surfaces ──

  /** `@tauri-apps/plugin-fs` replacement; unknown exports throw on access. */
  fsModule(): Record<string, unknown> {
    const impl: Record<string, unknown> = {
      readTextFile: (path: string) => this.disk.readTextFile(path),
      readFile: (path: string) => this.disk.readFile(path),
      writeTextFile: (path: string, contents: string) =>
        this.performWrite(path, contents, "writeTextFile"),
      exists: (path: string) => Promise.resolve(this.disk.has(path) || this.disk.hasDir(path)),
      mkdir: (path: string) => {
        this.disk.mkdirp(path);
        return Promise.resolve();
      },
      readDir: (path: string) => this.disk.readDir(path),
      remove: (path: string) => this.disk.remove(path),
      rename: (from: string, to: string) => this.disk.rename(from, to),
      stat: (path: string) => this.disk.stat(path),
    };
    return new Proxy(impl, {
      get(target, prop) {
        if (typeof prop !== "string") return undefined;
        if (prop in target) return target[prop];
        // Module-interop probes must stay silent or nothing can load at all.
        if (MODULE_INTEROP_KEYS.has(prop)) return undefined;
        // A missing export must not be `undefined` — that reads as
        // "not called" at the call site and passes silently.
        fail(
          `@tauri-apps/plugin-fs export "${prop}" is not modelled — ` +
            `add it to fsModule() instead of relying on a silent default`,
        );
      },
    });
  }

  /** `@tauri-apps/api/core` replacement (`invoke` only). */
  coreModule(): { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } {
    return { invoke: (cmd, args) => this.invoke(cmd, args) };
  }

  invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const custom = this.commands.get(cmd);
    if (custom) return Promise.resolve(custom(args));
    switch (cmd) {
      case "atomic_write_file": {
        const path = String(args.path);
        // `noReplace` mirrors the Rust writer's exclusive publication: a file
        // already there at the write's turn is kept and the write is refused
        // with the same typed conflict.
        if (args.noReplace === true && this.disk.has(path)) {
          return Promise.reject({
            code: "conflict",
            message: `A file already exists at ${path}, so it was not replaced`,
            detail: { kind: "target-exists", path },
          });
        }
        return this.performWrite(path, String(args.content), "atomic_write_file");
      }
      case "get_file_size_bytes": {
        const size = this.disk.byteSize(String(args.path));
        // The real command's typed rejection (`files/ops.rs` via `from_io`).
        if (size === null) {
          return Promise.reject({
            code: "not-found",
            message: `invalid path '${String(args.path)}': No such file or directory (os error 2)`,
          });
        }
        return Promise.resolve(size);
      }
      default:
        // Loud by design: an unmodelled command is a hole in the test's
        // claim about the flow, not a detail to default away.
        return Promise.reject(
          new Error(
            `statefulFsFake: unexpected invoke("${cmd}") — stubCommand() it ` +
              `if this flow legitimately calls it`,
          ),
        );
    }
  }

  // ── Internals ──

  private performWrite(path: string, content: string, via: WriteRecord["via"]): Promise<void> {
    if (this.writeFailure) return Promise.reject(this.writeFailure(path, content));
    const dir = parentOf(path);
    if (!this.disk.hasDir(dir)) {
      // `atomic_write_file` mirrors the Rust writer's TYPED not-found error,
      // which the save path parses to route into Save As
      // (`parseParentMissingError`); plugin-fs rejects with a plain io error.
      return Promise.reject(
        via === "atomic_write_file"
          ? { code: "not-found", message: `parent missing: ${dir}`, detail: { dir } }
          : new Error(`failed to write "${path}": No such file or directory (os error 2)`),
      );
    }
    this.writes.push({ path, content, via });
    this.disk.seed(path, content);
    return Promise.resolve();
  }
}

/** Shared instance — mock factories and the test body see the same disk. */
export const statefulFs = new StatefulFsFake();
