/**
 * Types for `alSpikeFingerprint.mjs`, for the TypeScript spike generators that
 * embed the fingerprint (the anchor and review probes under dev-docs/grills).
 *
 * @coordinates-with scripts/lib/alSpikeFingerprint.mjs — the implementation
 */

export type SpikeName = "revert" | "backend" | "txn" | "anchor" | "review";

export interface SpikeFingerprint {
  readonly algorithm: "sha256";
  /** sha256 over the sorted `<path>\0<file sha256>\n` lines. */
  readonly digest: string;
  /** Repo-relative path → sha256 of the file's bytes. */
  readonly files: Readonly<Record<string, string>>;
}

export const GRILLS_DIR: string;
export const SPIKE_INPUTS: Readonly<Record<SpikeName, { readonly inputs: readonly string[]; readonly outputs?: readonly string[] }>>;

/** The fingerprint of `spike`'s inputs under `root`; throws on an unknown spike or a missing input. */
export function spikeFingerprint(root: string, spike: SpikeName): SpikeFingerprint;

/** Which paths differ between two `files` maps, each list sorted. */
export function diffFingerprints(
  recorded: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>,
): { changed: string[]; added: string[]; removed: string[] };
