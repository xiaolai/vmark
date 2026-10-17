// WI-OC2.1 — no WYSIWYG extension contributes the same plugin, input rule or
// paste rule twice. An inherited `addProseMirrorPlugins` that calls
// `this.parent` runs again at every `.extend()` level above it, so the code
// block — CodeBlockLowlight extended four times by VMark — carried five lowlight
// highlighters, each decorating every code block on every load (#1565).
//
// Plugin keys are unique by construction (`lowlight$`, `lowlight$1`, …), so the
// check is on the FAMILY: the key without its counter. Unnamed plugins
// (`plugin$N`) have no family to compare and are left out, and so are rules
// whose `find` is a function: its pattern lives in a closure, so two different
// rules built by one helper print the same source.
import { afterEach, describe, expect, it } from "vitest";
import { Editor, getExtensionField, getSchemaTypeByName, type AnyExtension } from "@tiptap/core";
import type { Plugin } from "@tiptap/pm/state";
import { createTiptapExtensions } from "./createTiptapExtensions";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

type Rule = { find: unknown };

/** What one extension contributes, called the way Tiptap's ExtensionManager calls it. */
function contributions(host: Editor, extension: AnyExtension) {
  const context = {
    name: extension.name,
    options: extension.options,
    storage: host.extensionStorage[extension.name as keyof typeof host.extensionStorage],
    editor: host,
    type: getSchemaTypeByName(extension.name, host.schema),
  };
  const field = <T,>(name: "addProseMirrorPlugins" | "addInputRules" | "addPasteRules") =>
    getExtensionField<(() => T[]) | undefined>(extension, name, context)?.() ?? [];
  return {
    plugins: field<Plugin>("addProseMirrorPlugins"),
    rules: [...field<Rule>("addInputRules"), ...field<Rule>("addPasteRules")],
  };
}

/** Entries that occur more than once. */
function repeated(values: string[]): string[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function family(plugin: Plugin): string {
  return (plugin as unknown as { key: string }).key.replace(/\$\d*$/, "");
}

describe("extension contributions are not duplicated", () => {
  it("no extension yields a plugin family or a rule twice", () => {
    editor = new Editor({ extensions: createTiptapExtensions({ tabId: "tab-1" }) });
    const host = editor;
    const duplicates = (host.extensionManager.extensions as AnyExtension[]).flatMap((extension) => {
      const { plugins, rules } = contributions(host, extension);
      const families = repeated(plugins.map(family).filter((name) => name !== "plugin"));
      const patterns = rules.flatMap((rule) => (rule.find instanceof RegExp ? [String(rule.find)] : []));
      const rulesTwice = repeated(patterns);
      return [...families, ...rulesTwice].map((what) => `${extension.name}: ${what}`);
    });
    expect(duplicates).toEqual([]);
  });

  it("the editor runs exactly one lowlight highlighter, and keeps the code block's own plugins", () => {
    editor = new Editor({ extensions: createTiptapExtensions({ tabId: "tab-1" }) });
    const families = editor.state.plugins.map(family);
    expect(families.filter((name) => name === "lowlight")).toHaveLength(1);
    expect(families).toContain("codeBlockVSCodeHandler");
  });

  it("still highlights a code block, and follows an edit", () => {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: createTiptapExtensions({ tabId: "tab-1" }),
      content: {
        type: "doc",
        content: [{ type: "codeBlock", attrs: { language: "javascript" }, content: [{ type: "text", text: "const a = 1;" }] }],
      },
    });
    const keywords = () => [...editor!.view.dom.querySelectorAll(".hljs-keyword")].map((el) => el.textContent);
    expect(keywords()).toEqual(["const"]);

    editor.commands.insertContentAt(1, "let b = 2; ");
    expect(keywords()).toEqual(["let", "const"]);
  });
});
