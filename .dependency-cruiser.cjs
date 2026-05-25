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
          // Type bridging (imports plugin format types for unified type definitions)
          "src/types/cursorContext",
          // CJK formatter (reads settings for formatting rules)
          "src/lib/cjkFormatter/",
          // Workflow snapshot renderer (mounts the same JobNode the
          // side panel uses — visual parity is the WHOLE point per
          // dev-docs/plans/20260504-workflow-fence-snapshot.md ADR-1)
          "src/lib/ghaWorkflow/render/snapshotRoot",
          // Format-registry adapters (multi-format rebrand, Phase 1A).
          // Adapters are boundary modules that wire formats to React
          // components and stores by design. The leaf rule does not
          // model "adapter" as a concept; explicit exemption per WI-1A.3.
          "src/lib/formats/adapters/",
          // markdown-adapter-internal large-file helper — reads
          // largeFileSessionStore by design (WI-1A.6).
          "src/lib/formats/markdownLargeFile",
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
          // Source-twin popup needing its non-source sibling's operations
          // (parallel to the sourceLinkPopup / sourceImagePopup pattern above).
          "src/plugins/sourceLinkCreatePopup/",
          // Source-twin popup needing the latex katexLoader.
          "src/plugins/sourceMathPopup/",
          // markdownArtifacts parses frontmatter; frontmatterPanel owns its
          // node view. The parser→view coupling is the documented design.
          "src/plugins/markdownArtifacts/",
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
          // ADR-011: the plugin registry is the cross-cutting contract
          // module; every plugin's manifest.ts imports its PluginManifest
          // type. Treat it like shared/.
          "^src/plugins/registry\\.ts$",
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
