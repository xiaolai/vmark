// Purpose: token-aligned react-json-view-lite styling shared by the json /
// yaml / toml tree previews.
//
// The library themes correctly for light/dark via its own defaultStyles /
// darkStyles, but its value colors are the library's palette, not VMark's.
// jsonViewStyles() keeps the theme-correct base (container, row indentation,
// expand icons — chosen by isDark) and overrides ONLY the value/key/
// punctuation classes with our own, so a JSON/YAML/TOML file renders with the
// SAME GitHub-palette colors as the CodeMirror Source pane (source-syntax.css).
//
// The override class names resolve in json-view-theme.css, scoped under
// `.json-tree-preview` so they win over the library's single-class styles.
//
// @coordinates-with json-view-theme.css — defines the override classes
// @coordinates-with adapters/json.tsx, yaml.tsx, toml.tsx — consumers

import { defaultStyles, darkStyles, type JsonView } from "react-json-view-lite";
import type { ComponentProps } from "react";
import "./json-view-theme.css";

type JsonViewStyle = NonNullable<ComponentProps<typeof JsonView>["style"]>;

/**
 * Build the style object for `<JsonView style={...} />`.
 *
 * @param isDark whether the night theme is active — selects the library base
 *   that owns container/indentation/icon styling for the matching theme.
 */
export function jsonViewStyles(isDark: boolean): JsonViewStyle {
  const base = isDark ? darkStyles : defaultStyles;
  return {
    ...base,
    // Root container: keep the library's structural class but add ours to
    // neutralize its hardcoded background (darkStyles paints Solarized
    // #002b36, defaultStyles paints white) so the tree sits on the preview
    // pane's --bg-color — one unified surface with the source pane.
    container: `${base.container} vmark-json-view__container`,
    // Field names (object keys) — property blue, matching cm-hl-property.
    label: "vmark-json-view__key",
    // Expandable keys: keep the library's clickable affordance class and add
    // our color class (scoped CSS gives ours the cascade win).
    clickableLabel: `${base.clickableLabel} vmark-json-view__key`,
    // Scalars. booleans / null / undefined map to the number color, matching
    // theme.ts (tags.bool / tags.null → cm-hl-number) so source and tree agree.
    stringValue: "vmark-json-view__string",
    numberValue: "vmark-json-view__number",
    booleanValue: "vmark-json-view__number",
    nullValue: "vmark-json-view__number",
    undefinedValue: "vmark-json-view__number",
    otherValue: "vmark-json-view__other",
    punctuation: "vmark-json-view__punctuation",
  };
}
