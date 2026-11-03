/**
 * The workflow group's strings live in the `workflowEditor` bundle, and the
 * Settings window is its own webview with its own i18next instance.
 *
 * i18next does not load a namespace because a key names it: `t("ns:key")`
 * strips the prefix, looks the key up in that namespace, and — when the
 * namespace was never loaded — answers with the key itself. The window has to
 * LOAD the namespace, or the group renders "settings.groupTitle" in every
 * language, which is what it did.
 *
 * The global test setup mocks react-i18next and @/i18n, and the mock resolves
 * a namespace prefix against a static map: it cannot tell a loaded namespace
 * from an unloaded one, so the whole class of bug is invisible to it. This
 * file therefore runs against the real i18next, the real bundle loader and
 * the real react-i18next.
 *
 * @coordinates-with src/i18n.ts — the instance this renders through
 * @module pages/settings/AdvancedSettings.i18n.test
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// The mock in `src/test/setup.ts` resolves namespaces statically; this file
// needs the real loader. Both unmocks are hoisted above the imports below.
vi.unmock("react-i18next");
vi.unmock("@/i18n");

import { AdvancedSettings } from "./AdvancedSettings";

/** The English copy of the five strings this group reads. */
const GROUP_TITLE = "Workflow files";
const FETCH_LABEL = "Fetch action metadata";
const ACTIONLINT_LABEL = "Use actionlint when available";

describe("AdvancedSettings — the workflow group reads the workflowEditor bundle", () => {
  it("renders the group title, not the key", async () => {
    const i18n = (await import("@/i18n")).default;
    expect(i18n.language).toBe("en");

    render(<AdvancedSettings />);

    await waitFor(() => {
      expect(screen.getByText(GROUP_TITLE)).toBeTruthy();
    });
    // The failure this pins: the key itself, rendered as the title.
    expect(screen.queryByText("settings.groupTitle")).toBeNull();
  });

  it("renders both toggle labels, not their keys", async () => {
    render(<AdvancedSettings />);

    await waitFor(() => {
      expect(screen.getByText(FETCH_LABEL)).toBeTruthy();
    });
    expect(screen.getByText(ACTIONLINT_LABEL)).toBeTruthy();
    expect(screen.queryByText("settings.fetchActionMetadata.label")).toBeNull();
    expect(screen.queryByText("settings.actionlint.label")).toBeNull();
  });
});
