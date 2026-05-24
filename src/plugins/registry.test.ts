/**
 * Plugin registry tests — ADR-011.
 */

import { beforeEach, describe, it, expect } from "vitest";
import {
  registerPlugin,
  getPlugin,
  listPlugins,
  pluginsFor,
  _resetRegistry,
  type PluginManifest,
} from "./registry";

const linkPopupManifest: PluginManifest = {
  id: "linkPopup",
  formats: ["markdown"],
  modes: ["wysiwyg", "source"],
};

const yamlOnlyManifest: PluginManifest = {
  id: "yamlSchema",
  formats: ["yaml"],
  modes: ["source"],
};

describe("plugin registry", () => {
  beforeEach(() => _resetRegistry());

  it("registers and retrieves manifests by id", () => {
    registerPlugin(linkPopupManifest);
    expect(getPlugin("linkPopup")?.id).toBe("linkPopup");
  });

  it("rejects duplicate registrations", () => {
    registerPlugin(linkPopupManifest);
    expect(() => registerPlugin(linkPopupManifest)).toThrow(/already registered/);
  });

  it("listPlugins returns every manifest", () => {
    registerPlugin(linkPopupManifest);
    registerPlugin(yamlOnlyManifest);
    expect(listPlugins()).toHaveLength(2);
  });

  it("pluginsFor filters by mode + format", () => {
    registerPlugin(linkPopupManifest);
    registerPlugin(yamlOnlyManifest);

    expect(pluginsFor("wysiwyg", "markdown")).toHaveLength(1);
    expect(pluginsFor("wysiwyg", "markdown")[0].id).toBe("linkPopup");

    expect(pluginsFor("source", "yaml")).toHaveLength(1);
    expect(pluginsFor("source", "yaml")[0].id).toBe("yamlSchema");

    // linkPopup is also "source", but only for markdown
    expect(pluginsFor("source", "yaml").map((p) => p.id)).not.toContain("linkPopup");
  });

  it("pluginsFor returns empty when no manifest matches", () => {
    registerPlugin(yamlOnlyManifest);
    expect(pluginsFor("wysiwyg", "markdown")).toHaveLength(0);
  });
});
