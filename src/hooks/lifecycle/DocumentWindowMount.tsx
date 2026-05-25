/**
 * DocumentWindowMount — conditional-mount wrapper for document-window composites (T03).
 *
 * React forbids conditional hook calls, so the document and window
 * composites (which only apply to actual document windows, not to
 * settings/pdf-export routes) live behind this component.
 *
 * MainLayout renders `<DocumentWindowMount />` when
 * `isDocumentWindow` is true.
 *
 * @module hooks/lifecycle/DocumentWindowMount
 */

import { useDocumentLifecycle } from "./useDocumentLifecycle";
import { useWindowLifecycle } from "./useWindowLifecycle";

export function DocumentWindowMount(): null {
  useDocumentLifecycle();
  useWindowLifecycle();
  return null;
}
