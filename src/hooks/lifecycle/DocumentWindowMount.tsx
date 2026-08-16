/**
 * DocumentWindowMount — conditional-mount wrapper for document-window composites (T03).
 *
 * React forbids conditional hook calls, so the document and window
 * composites (which only apply to actual document windows, not to
 * settings/pdf-export routes) live behind this component. Secondary
 * document windows also mount their Finder hot-open listener here; main keeps
 * its listener in `MainWindowRunners` after resilience startup.
 *
 * MainLayout renders `<DocumentWindowMount />` when
 * `isDocumentWindow` is true.
 *
 * @module hooks/lifecycle/DocumentWindowMount
 */

import { useDocumentLifecycle } from "./useDocumentLifecycle";
import { useWindowLifecycle } from "./useWindowLifecycle";
import { useFinderFileOpen } from "@/hooks/useFinderFileOpen";
import { useWindowLabel } from "@/contexts/WindowContext";

function SecondaryFinderFileOpenRunner(): null {
  useFinderFileOpen();
  return null;
}

export function DocumentWindowMount(): React.ReactElement | null {
  useDocumentLifecycle();
  useWindowLifecycle();
  const windowLabel = useWindowLabel();

  return windowLabel.startsWith("doc-") ? <SecondaryFinderFileOpenRunner /> : null;
}
