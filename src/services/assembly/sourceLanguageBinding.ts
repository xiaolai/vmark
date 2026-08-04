/**
 * Source-editor language binding.
 *
 * Purpose: give the CodeMirror source editor the language pack the format
 *   registry names for a file, now that `FormatConfig.language` is an import
 *   thunk (WI-13) rather than a synchronous factory.
 *
 *   The field was synchronous so the primary format would never paint an
 *   unhighlighted frame. That premise cost more than it bought: synchronous
 *   meant the markdown ADAPTER statically imported the pack, and the adapter is
 *   evaluated by `bootstrapFormats()` in every window before `import("./App")`,
 *   so Settings and PDF-export windows loaded CodeMirror to render no editor.
 *
 *   The no-flash property survives here instead: the compartment mounts with
 *   the markdown pack — statically imported by this module, which lives in the
 *   already-lazy SourceEditor chunk — and the format's own pack replaces it
 *   when the thunk resolves. Markdown is both the fallback and the only format
 *   this editor hosts today, so the first painted frame is unchanged.
 *
 * Key decisions:
 *   - A ViewPlugin, not a mount-effect callback. The load is tied to the
 *     view's lifetime, and CodeMirror already has a name for that; putting it
 *     in SourceEditor.tsx would spread the view's lifecycle across two files.
 *   - Failure resolves to null rather than throwing. Imperfect highlighting is
 *     recoverable; an exception out of the mount path is not.
 *   - Resolution goes through `resolveFormatSurface` (audit 20260804-F6). This
 *     module used to invoke the thunk directly, which meant the SHARED cache
 *     that exists precisely to make "one evaluation per format" true was
 *     bypassed on the production path: two panes, a split view, or a remount
 *     each rebuilt the CodeMirror language pack — megabytes of grammar work
 *     per mount, and two module instances live at once.
 *   - A REJECTED thunk is distinguished from "no pack declared" and from "no
 *     format registered" (audit 20260804-F14). All three keep the markdown
 *     fallback, but only the rejection is a malfunction, and collapsing them
 *     into one silent `null` left a user with mis-highlighted source and no
 *     trace of why. Logged once per format so a retrying mount cannot spam.
 *
 * @coordinates-with services/assembly/sourceEditorExtensions.ts — composes the extension
 * @coordinates-with lib/formats/lazySurfaces.ts — the shared thunk resolution cache
 * @coordinates-with lib/formats/types.ts — the `language` thunk contract
 * @module services/assembly/sourceLanguageBinding
 */
import { Compartment, type Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView } from "@codemirror/view";
import { markdownLanguageSupport } from "@/lib/formats/markdownLanguageSupport";
import { languages } from "@codemirror/language-data";
import { dispatchEditor } from "@/lib/formats/registry";
import { resolveFormatSurface } from "@/lib/formats/lazySurfaces";
import { formatsWarn } from "@/utils/debug";

/** Owns the language pack so the resolved one can replace the fallback.
 *  Module-private: nothing outside reconfigures it, and exporting it would
 *  invite a second writer racing the one below. */
const languageCompartment = new Compartment();

/**
 * Format ids whose language thunk has already been reported as failed. A
 * rejected chunk usually stays rejected, and the binding runs per view mount —
 * without this a user opening ten tabs gets ten identical lines.
 */
const reportedFailures = new Set<string>();

/** Test seam: forget which failures have been reported. */
export function __resetLanguageFailureReports(): void {
  reportedFailures.clear();
}

/**
 * The pack `filePath`'s format declares, or null to keep the fallback.
 *
 * Null still covers all three "no answer" cases, because all three leave the
 * markdown fallback standing. They are no longer INDISTINGUISHABLE, though:
 *   - no format registered at all (`dispatchEditor` throws on an empty
 *     registry — the state unit tests that build extensions without
 *     bootstrapping run in) → silent, this is a normal state;
 *   - the format declares no pack → silent, this is a declaration;
 *   - the thunk REJECTED → warned once per format, because this one is a
 *     malfunction and the user's only other symptom is wrong highlighting.
 */
export async function loadFormatLanguage(
  filePath: string | null | undefined,
): Promise<Extension | null> {
  let formatId: string;
  let thunk: (() => Promise<Extension>) | undefined;
  try {
    const config = dispatchEditor(filePath ?? null);
    formatId = config.id;
    thunk = config.language;
  } catch {
    return null;
  }
  if (!thunk) return null;

  try {
    // Through the shared cache, not the raw thunk: concurrent mounts share one
    // evaluation and a resolved pack is reused instead of rebuilt.
    return await resolveFormatSurface(formatId, "language", thunk);
  } catch (error) {
    if (!reportedFailures.has(formatId)) {
      reportedFailures.add(formatId);
      formatsWarn(
        `language pack for "${formatId}" failed to load; keeping the markdown fallback`,
        error,
      );
    }
    return null;
  }
}

/**
 * The `source.language` extension: the markdown fallback in a compartment,
 * plus a view plugin that swaps in the format's own pack when it arrives.
 */
export function formatLanguageExtension(filePath: string | null | undefined): Extension {
  return [
    languageCompartment.of(markdownLanguageSupport(languages)),
    ViewPlugin.fromClass(
      class {
        private cancelled = false;

        constructor(view: EditorView) {
          void loadFormatLanguage(filePath).then((language) => {
            /* v8 ignore next -- @preserve unmount race */
            if (this.cancelled || language == null) return;
            view.dispatch({ effects: languageCompartment.reconfigure(language) });
          });
        }

        destroy() {
          this.cancelled = true;
        }
      },
    ),
  ];
}
