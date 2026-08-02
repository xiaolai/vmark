// Regression cover for #1187 — a brand-new workspace's config was minted with
// an EMPTY excludeFolders, so the file explorer walked node_modules/.git.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DEFAULT_EXCLUDED_FOLDERS,
  normalizeWorkspaceConfig,
  repairAutoCreatedExcludeFolders,
} from "./workspaceConfigDefaults";
import type { WorkspaceConfig } from "./workspaceStore";

vi.mock("@/utils/workspaceIdentity", () => ({
  createWorkspaceIdentity: vi.fn(() => ({
    id: "mock-uuid-1234",
    createdAt: 1700000000000,
    trustLevel: "untrusted",
    trustedAt: null,
  })),
}));

const IDENTITY = {
  id: "disk-id",
  createdAt: 1,
  trustLevel: "untrusted" as const,
  trustedAt: null,
};

function config(overrides: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
  return {
    version: 1,
    excludeFolders: [],
    lastOpenTabs: [],
    showHiddenFiles: false,
    showAllFiles: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("repairAutoCreatedExcludeFolders", () => {
  it("restores the defaults for an identity-less empty exclude list", () => {
    const repaired = repairAutoCreatedExcludeFolders(config());
    expect(repaired.excludeFolders).toEqual(DEFAULT_EXCLUDED_FOLDERS);
  });

  it("leaves an empty list the user cleared deliberately (identity present)", () => {
    const repaired = repairAutoCreatedExcludeFolders(config({ identity: IDENTITY }));
    expect(repaired.excludeFolders).toEqual([]);
  });

  it("never overwrites a non-empty exclude list", () => {
    expect(
      repairAutoCreatedExcludeFolders(config({ excludeFolders: ["dist"] })).excludeFolders,
    ).toEqual(["dist"]);
    expect(
      repairAutoCreatedExcludeFolders(
        config({ excludeFolders: ["dist"], identity: IDENTITY }),
      ).excludeFolders,
    ).toEqual(["dist"]);
  });

  it("preserves every other field untouched", () => {
    const input = config({ showHiddenFiles: true, lastOpenTabs: ["/a.md"] });
    const repaired = repairAutoCreatedExcludeFolders(input);
    expect(repaired.showHiddenFiles).toBe(true);
    expect(repaired.lastOpenTabs).toEqual(["/a.md"]);
    expect(repaired.version).toBe(1);
  });

  it("does not mint an identity — that stays normalizeWorkspaceConfig's job", () => {
    expect(repairAutoCreatedExcludeFolders(config()).identity).toBeUndefined();
  });

  it("is idempotent: a repaired config is no longer a repair candidate", () => {
    const once = repairAutoCreatedExcludeFolders(config());
    const twice = repairAutoCreatedExcludeFolders(once);
    expect(twice.excludeFolders).toEqual(DEFAULT_EXCLUDED_FOLDERS);
  });

  it("does not hand back the shared DEFAULT_EXCLUDED_FOLDERS array", () => {
    const repaired = repairAutoCreatedExcludeFolders(config());
    expect(repaired.excludeFolders).not.toBe(DEFAULT_EXCLUDED_FOLDERS);
    repaired.excludeFolders.push("mutated");
    expect(DEFAULT_EXCLUDED_FOLDERS).not.toContain("mutated");
  });

  it("does not mutate the caller's config", () => {
    const input = config();
    repairAutoCreatedExcludeFolders(input);
    expect(input.excludeFolders).toEqual([]);
  });
});

describe("normalizeWorkspaceConfig", () => {
  it("uses the defaults when there is no config at all", () => {
    expect(normalizeWorkspaceConfig(null).excludeFolders).toEqual(DEFAULT_EXCLUDED_FOLDERS);
    expect(normalizeWorkspaceConfig().excludeFolders).toEqual(DEFAULT_EXCLUDED_FOLDERS);
  });

  it("repairs an auto-created empty exclude list", () => {
    expect(normalizeWorkspaceConfig(config()).excludeFolders).toEqual(DEFAULT_EXCLUDED_FOLDERS);
  });

  it("keeps a deliberately cleared list", () => {
    expect(normalizeWorkspaceConfig(config({ identity: IDENTITY })).excludeFolders).toEqual([]);
  });

  it("keeps a custom exclude list", () => {
    expect(normalizeWorkspaceConfig(config({ excludeFolders: ["custom"] })).excludeFolders).toEqual([
      "custom",
    ]);
  });

  it("mints an identity when the config has none", () => {
    expect(normalizeWorkspaceConfig(config()).identity?.id).toBe("mock-uuid-1234");
  });

  it("preserves an existing identity", () => {
    expect(normalizeWorkspaceConfig(config({ identity: IDENTITY })).identity?.id).toBe("disk-id");
  });

  it("never aliases the module default or the caller's arrays", () => {
    const callerOwned = ["dist"];
    const normalized = normalizeWorkspaceConfig(config({ excludeFolders: callerOwned }));
    expect(normalized.excludeFolders).not.toBe(callerOwned);
    expect(normalizeWorkspaceConfig(null).excludeFolders).not.toBe(DEFAULT_EXCLUDED_FOLDERS);
  });
});
