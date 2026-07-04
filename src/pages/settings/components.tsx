/**
 * Shared Settings UI Primitives (barrel)
 *
 * The components re-exported here are the canonical building blocks for
 * every page in `src/pages/settings/`. New panels should compose these —
 * not write inline Tailwind on a raw `<input>`/`<button>`/`<select>` — so
 * visual treatment and accessibility stay coherent.
 *
 * Implementations live in sibling files, grouped by role:
 *   - `layout.tsx`   SettingRow, SettingsGroup, CollapsibleGroup
 *   - `inputs.tsx`   Toggle, Select, SearchInput, FieldInput
 *   - `TagInput.tsx` TagInput
 *   - `buttons.tsx`  Button, CopyButton, CloseButton
 * Import from this barrel (`./components`), not the sibling files.
 *
 * THREE TEXT-INPUT PRIMITIVES — named for their CONTEXT, not their visual
 * style. Pick by the noun, not by the pixels:
 *
 *   <SearchInput>   Toolbar / inline / single-field-in-a-group inputs.
 *                   Bottom-border focus highlight; transparent background.
 *                   Borrows visual structure from surroundings.
 *                   Use for: search boxes, single-field-with-button rows,
 *                   inline lookups.
 *
 *   <FieldInput>    Stacked form fields (multiple inputs in a column).
 *                   Full border + tinted background — clear "fillable"
 *                   affordance.
 *                   Use for: API endpoints, keys, paths, anything where
 *                   several fields sit together and each needs to look
 *                   like a thing you fill in.
 *
 *   <Select>        Dropdown picker. Already canonical.
 *                   Use for: enum-like choices.
 *
 * If none of these fit a new context, ASK before adding a 4th primitive.
 * The temptation is to add `variant` props — resist it. Variant names
 * describe pixels; primitive names describe intent. Intent is harder to
 * misuse.
 *
 * All colors use CSS variables for theme consistency.
 */

export { SettingRow, SettingsGroup, CollapsibleGroup, SearchableSection } from "./layout";
export { Toggle, Select, SearchInput, FieldInput } from "./inputs";
export type { SearchInputProps, FieldInputProps } from "./inputs";
export { TagInput } from "./TagInput";
export { Button, CopyButton, CloseButton } from "./buttons";
