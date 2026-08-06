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

    // Rule 3b: utils/ is leaf-pure — no Tauri, no services, no hooks, no
    // React, no i18n (ADR-013). Audit 20260612 H2/H3: 12 Tauri-dependent
    // files were migrated to services/ domains; this rule keeps utils pure.
    {
      name: "utils-no-platform",
      severity: "error",
      comment:
        "ADR-013: src/utils/ may import only stdlib and other utils/. " +
        "A file needing Tauri APIs, services, hooks, React, or i18n belongs in services/.",
      from: {
        path: "^src/utils/",
        pathNot: [
          // Debug loggers lazily import @tauri-apps/plugin-log behind a
          // dynamic import; logging must stay importable from every tier,
          // so this is the one sanctioned platform touch in utils/.
          "^src/utils/debug",
        ],
      },
      to: {
        path: [
          "@tauri-apps",
          "^src/services/",
          "^src/hooks/",
          "^src/i18n",
          "node_modules/react",
        ],
      },
    },

    // Rule 3c: services/ must not import upward (hooks/components/React).
    // ADR-013 defines hooks/ as React adapters OVER services. The pathNot
    // list freezes the violations known at audit 20260612 (finding H4,
    // deferred) — do NOT add new entries; extract the logic into services/
    // instead.
    {
      name: "services-no-upward",
      severity: "error",
      comment:
        "ADR-013: src/services/ may import utils/, stores/, and Tauri APIs — " +
        "not hooks/, components/, or React. Known violations are frozen " +
        "pending the H4 inversion cleanup; new code must not extend this list.",
      from: {
        path: "^src/services/",
        pathNot: [
          // Tests may import hooks/components to mock them
          "\\.test\\.(ts|tsx)$",
          // Sanctioned (permanent) seams — NOT debt (the H4 inversion is done):
          //  - imeToastPinAction builds a React.ReactNode toast label; moving it
          //    to components/ would make a service import the UI tier (worse).
          //  - assembly/tiptapExtensions composes editor extensions from
          //    plugins/components by design (the de-facto wiring tier).
          "^src/services/ime/imeToastPinAction\\.tsx$",
          "^src/services/assembly/tiptapExtensions\\.ts$",
        ],
      },
      to: {
        path: ["^src/hooks/", "^src/components/", "node_modules/react"],
      },
    },

    // Rule 5: the Node-safe markdown seam stays Node-safe (ADR-015 D2, WI-1.4).
    //
    // `nodeSafe.ts` re-exports the remark plugins to `server/content`,
    // which runs in plain Node. Its header states the invariant — no `@/`
    // aliases, no DOM globals, no editor/ProseMirror imports — but until now
    // only a smoke test guarded it, and only at runtime.
    //
    // ADR-015 splits conversion into an engine-independent markdown layer
    // (registry 1, here) and a ProseMirror-coupled adapter layer (registry 2).
    // The audit found ADR-003's "framework-independent pipeline" was never
    // fully realized — 11 of 19 pipeline files import `@tiptap/pm/model` — so
    // this boundary is being CREATED, not merely preserved. It needs a gate
    // from day one, or it will drift like every seam before it.
    {
      name: "node-safe-markdown-seam",
      severity: "error",
      comment:
        "src/utils/markdownPipeline/{plugins,nodeSafe,types} must stay importable " +
        "from plain Node: no ProseMirror, no React, no @/ aliases, no editor code.",
      from: {
        path: "^src/utils/markdownPipeline/(plugins/|nodeSafe\\.ts|types\\.ts)",
        pathNot: ["\\.test\\.(ts|tsx)$"],
      },
      to: {
        path: [
          "@tiptap",
          "prosemirror",
          "node_modules/react",
          "^src/(components|plugins|stores|hooks|services)/",
        ],
      },
    },

    // Rule 4: Cross-plugin imports only via shared/ or coordination plugins
    //
    // WI-8 (arch review B3): the former "verified cross-plugin dependencies"
    // block granted 17 plugin-WIDE licenses that masked every edge those
    // plugins had or would ever grow. Deleted. Every real existing edge is
    // now frozen INDIVIDUALLY in `.dependency-cruiser-known-violations.json`
    // (regenerate with `pnpm exec depcruise-baseline src --config
    // .dependency-cruiser.cjs` — only ever to record a REMOVED edge; the
    // count ratchets down via scripts/extension-budget.json). Only true
    // coordination plugins — whose PURPOSE is orchestrating other plugins —
    // keep a license, each with its reason below.
    {
      name: "plugin-isolation",
      severity: "error",
      comment:
        "Plugins should be self-contained. Cross-plugin imports go through shared/ or a coordination plugin; every other existing edge is frozen per-edge in .dependency-cruiser-known-violations.json and ratchets down.",
      from: {
        path: "^src/plugins/([^/]+)/",
        pathNot: [
          // Dispatches every toolbar/context-menu action into the feature
          // plugins — cross-plugin dispatch is its entire purpose.
          "src/plugins/toolbarActions/",
          // Source-mode assembly cluster (40+ files): composes the CodeMirror
          // extension stack from the feature plugins.
          "src/plugins/codemirror/",
          // Composes cross-plugin editor commands/keymaps (multiCursor,
          // syntaxReveal, toolbarActions policies) into the WYSIWYG editor.
          "src/plugins/editorPlugins/",
          // WYSIWYG toolbar surface built on toolbarContext's intent types.
          "src/plugins/formatToolbar/",
          // Fence-preview hub: dispatches rendering/export to the diagram
          // plugins (mermaid, graphviz, markmap, svg, latex) by design.
          "src/plugins/codePreview/",
        ],
      },
      to: {
        path: "^src/plugins/",
        pathNot: [
          "^src/plugins/$1/",
          "^src/plugins/shared/",
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
        "server/mcp",
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
