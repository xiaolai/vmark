// @vitest-environment node
/**
 * Tests for isValidWorkspaceConfig, the frontend re-check of the
 * `read_workspace_config` payload before it drives tab restore and explorer
 * filtering.
 *
 * Covers: the shape Rust serializes is accepted (with or without the optional
 * and frontend-only fields, and with a future version number); every core
 * field that is missing or mistyped, including a non-string array element, is
 * refused; non-objects are refused.
 */
import { describe, expect, it } from "vitest";
import { isValidWorkspaceConfig } from "./workspaceConfigGuard";

const VALID = { version: 1, excludeFolders: [".git"], lastOpenTabs: ["/w/a.md"], showHiddenFiles: false };

describe("isValidWorkspaceConfig", () => {
  it.each([
    ["the minimal Rust shape", VALID],
    ["empty arrays", { ...VALID, excludeFolders: [], lastOpenTabs: [] }],
    ["a future version number", { ...VALID, version: 7 }],
    ["optional ai / identity, not validated", { ...VALID, ai: { anything: true }, identity: 42 }],
    ["the frontend-only showAllFiles", { ...VALID, showAllFiles: true }],
  ])("accepts %s", (_label, config) => {
    expect(isValidWorkspaceConfig(config)).toBe(true);
  });

  it.each([
    ["version missing", { ...VALID, version: undefined }],
    ["version as a string", { ...VALID, version: "1" }],
    ["excludeFolders missing", { ...VALID, excludeFolders: undefined }],
    ["excludeFolders not an array", { ...VALID, excludeFolders: ".git" }],
    ["a non-string excludeFolders entry", { ...VALID, excludeFolders: [".git", 3] }],
    ["lastOpenTabs missing", { ...VALID, lastOpenTabs: undefined }],
    ["a null lastOpenTabs entry", { ...VALID, lastOpenTabs: [null] }],
    ["showHiddenFiles as a string", { ...VALID, showHiddenFiles: "false" }],
    ["showHiddenFiles missing", { ...VALID, showHiddenFiles: undefined }],
  ])("refuses %s", (_label, config) => {
    expect(isValidWorkspaceConfig(config)).toBe(false);
  });

  it.each([null, undefined, 1, "config", true, []])("refuses the non-object %j", (raw) => {
    expect(isValidWorkspaceConfig(raw)).toBe(false);
  });
});
