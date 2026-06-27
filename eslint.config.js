import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src-tauri"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The React Compiler rule set (folded into `recommended` by
      // eslint-plugin-react-hooks v7) is fully adopted — #1063. Genuine
      // render-derivable cases were refactored (adjust-state-during-render, layout
      // effects, re-keyed memos); legitimate effect-bound cases (async I/O, timers,
      // DOM measurement, external-event sync, open/close transitions) carry a
      // scoped disable with a per-site reason. These stay at `error` so new
      // violations are caught at the source.
      // `exhaustive-deps` was historically `warn` under v5's recommended; v7 raised
      // it to error. Kept non-blocking to match prior behavior — its ~67 sites are
      // out of scope for #1063.
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "prefer-const": "warn",
    },
  },
  // Test file overrides
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  }
);
