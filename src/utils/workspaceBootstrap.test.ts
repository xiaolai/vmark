/**
 * Unit tests for workspace bootstrap logic
 *
 * Validates the decision logic for when workspace config needs to be loaded:
 * - If rootPath exists but config is null, bootstrap is needed
 * - If rootPath and config both exist, no bootstrap needed
 * - If no rootPath, no bootstrap needed
 */
import { describe, it, expect } from "vitest";
import {
  needsBootstrap,
  type WorkspaceBootstrapState,
} from "./workspaceBootstrap";

describe("workspaceBootstrap", () => {
  describe("needsBootstrap", () => {
    it("returns true when rootPath exists but config is null", () => {
      const state: WorkspaceBootstrapState = {
        rootPath: "/path/to/workspace",
        config: null,
        isWorkspaceMode: true,
      };
      expect(needsBootstrap(state)).toBe(true);
    });

    it("returns false when rootPath is null", () => {
      const state: WorkspaceBootstrapState = {
        rootPath: null,
        config: null,
        isWorkspaceMode: false,
      };
      expect(needsBootstrap(state)).toBe(false);
    });

    it("returns false when both rootPath and config exist", () => {
      const state: WorkspaceBootstrapState = {
        rootPath: "/path/to/workspace",
        config: {
          version: 1,
          excludeFolders: [".git"],
          lastOpenTabs: [],
        },
        isWorkspaceMode: true,
      };
      expect(needsBootstrap(state)).toBe(false);
    });

    it("returns true when isWorkspaceMode true but config missing", () => {
      const state: WorkspaceBootstrapState = {
        rootPath: "/path/to/workspace",
        config: null,
        isWorkspaceMode: true,
      };
      expect(needsBootstrap(state)).toBe(true);
    });

    it("returns false when rootPath exists but isWorkspaceMode is false", () => {
      // Edge case: shouldn't happen normally, but be safe
      const state: WorkspaceBootstrapState = {
        rootPath: "/path/to/workspace",
        config: null,
        isWorkspaceMode: false,
      };
      expect(needsBootstrap(state)).toBe(false);
    });
  });
});
