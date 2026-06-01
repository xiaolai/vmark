/**
 * Settings search results (D2).
 *
 * Stacks every searchable panel under its category heading. Row visibility is
 * handled in CSS (settings-search.css) driven by `SettingsSearchContext`, so
 * this component only lays out the panels and reports when nothing matched.
 *
 * @module pages/settings/SettingsSearchResults
 */

import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export interface SearchablePanel {
  id: string;
  label: string;
  Component: React.ComponentType;
}

export function SettingsSearchResults({
  panels,
  query,
}: {
  panels: SearchablePanel[];
  query: string;
}) {
  const { t } = useTranslation("settings");
  const containerRef = useRef<HTMLDivElement>(null);
  const [hasResults, setHasResults] = useState(true);

  // After each query change, count the rows CSS left visible. useLayoutEffect
  // so the "no results" message never flashes against a stale count.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const visible = el.querySelectorAll(
      '[data-setting-row][data-search-visible="true"]'
    ).length;
    setHasResults(visible > 0);
  }, [query]);

  return (
    <div ref={containerRef}>
      {!hasResults && (
        <div className="text-sm text-[var(--text-tertiary)] py-4">
          {t("search.noResults", { query })}
        </div>
      )}
      {panels.map(({ id, label, Component }) => (
        <section key={id} data-settings-panel className="mb-8">
          <div
            className="text-xs font-semibold uppercase tracking-wide
                       text-[var(--text-tertiary)] mb-3"
          >
            {label}
          </div>
          <Component />
        </section>
      ))}
    </div>
  );
}
