/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // Rule 1: No circular dependencies
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies cause tight coupling and make refactoring hard.",
      from: {},
      to: { circular: true },
    },

    // Rule 2: Stores must not import components
    {
      name: "stores-no-import-components",
      severity: "error",
      comment: "Data layer must not know about UI. Stores are leaf dependencies.",
      from: { path: "^src/stores/" },
      to: { path: "^src/components/" },
    },

    // Rule 3: utils/types/lib must not import plugins/components/stores
    //
    // Exempted files — verified "wiring" or "service" modules that inherently
    // need cross-layer imports. New utils should stay pure; add exemptions here
    // only after review.
    {
      name: "leaf-modules-stay-pure",
      severity: "error",
      comment:
        "utils/, types/, and lib/ are leaf modules. They must not import from plugins/, components/, or stores/.",
      from: {
        path: "^src/(utils|types|lib)/",
        pathNot: [
          // Assembler files (wire plugins into editor configurations)
          "src/utils/tiptapExtensions\\.ts$",
          "src/utils/sourceEditorExtensions\\.ts$",
          "src/utils/modeSwitchCleanup\\.ts$",
          // File operation services (need store access for tab/document state)
          "src/utils/activeDocument",
          "src/utils/saveToPath",
          "src/utils/newFile",
          "src/utils/reloadFromDisk",
          "src/utils/workspaceBootstrap",
          // Media path resolution (needs tab/document store for relative path resolution)
          "src/utils/resolveMediaSrc",
          // Editor services (bridge between editor internals and stores)
          "src/utils/tiptapFocus",
          "src/utils/sourcePeek",
          "src/utils/extractContext",
          "src/utils/menuListenerHelper",
          "src/utils/clipboardUrl",
          "src/utils/imageResize",
          // Hot exit module (captures/restores full app state)
          "src/utils/hotExit/",
          // Type bridging (imports plugin format types for unified type definitions)
          "src/types/cursorContext",
          // CJK formatter (reads settings for formatting rules)
          "src/lib/cjkFormatter/",
        ],
      },
      to: { path: "^src/(plugins|components|stores)/" },
    },

    // Rule 4: Cross-plugin imports only via shared/ or sourcePopup/
    //
    // Coordination plugins are exempted — they orchestrate multiple plugins
    // by design. The rule still catches isolated plugins that shouldn't reach
    // into other plugins' internals.
    {
      name: "plugin-isolation",
      severity: "warn",
      comment:
        "Plugins should be self-contained. Cross-plugin imports are allowed only through shared/, sourcePopup/, or coordination plugins.",
      from: {
        path: "^src/plugins/([^/]+)/",
        pathNot: [
          // Coordination plugins (inherently cross-cutting)
          "src/plugins/toolbarActions/",
          "src/plugins/toolbarContext/",
          "src/plugins/sourceContextDetection/",
          "src/plugins/codemirror/",
          "src/plugins/formatToolbar/",
          "src/plugins/editorPlugins/",
          "src/plugins/codePreview/",
          // Plugins with verified cross-plugin dependencies
          "src/plugins/tabIndent/",
          "src/plugins/blockEscape/",
          "src/plugins/blockImage/",
          "src/plugins/sourcePeekInline/",
          "src/plugins/sourceLinkPopup/",
          "src/plugins/sourceImagePopup/",
          "src/plugins/htmlPaste/",
          "src/plugins/markdownPaste/",
          "src/plugins/aiSuggestion/",
          "src/plugins/mathPopup/",
          "src/plugins/mathPreview/",
          "src/plugins/mermaidPreview/",
          "src/plugins/latex/",
          "src/plugins/shared/",
        ],
      },
      to: {
        path: "^src/plugins/",
        pathNot: [
          "^src/plugins/$1/",
          "^src/plugins/shared/",
          "^src/plugins/sourcePopup/",
        ],
      },
    },
  ],

  options: {
    doNotFollow: {
      path: [
        "node_modules",
        "dist",
        "target",
        "vmark-mcp-server",
        "website",
        "coverage",
      ],
    },

    tsPreCompilationDeps: true,

    tsConfig: { fileName: "tsconfig.json" },

    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },

    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
