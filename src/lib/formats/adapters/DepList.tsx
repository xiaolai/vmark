/**
 * Shared dependency-list section used by every schema renderer that
 * displays a manifest's dependencies (cargoToml.tsx, packageJson.tsx,
 * pyprojectToml.tsx).
 *
 * Each adapter normalizes its native record shape (Cargo's `version` +
 * features; npm's `version` string; PEP 508 / Poetry `spec`) into a
 * common DepEntry, then passes a list of them to <DepList />.
 *
 * @module lib/formats/adapters/DepList
 */

export interface DepEntry {
  /** Package / crate name. */
  name: string;
  /**
   * Free-form version-or-version-spec. Empty string means "no
   * version reported" (e.g. PEP 508 entries that name only).
   */
  version: string;
  /** Cargo-style feature flags. Other ecosystems leave undefined. */
  features?: string[];
}

export interface DepListProps {
  /** Section heading — typically a localized label. */
  title: string;
  deps: DepEntry[];
}

/** Renders nothing when `deps` is empty so callers can pass groups
 *  unconditionally and keep the JSX flat. */
export function DepList({ title, deps }: DepListProps) {
  if (deps.length === 0) return null;
  return (
    <section className="dep-tree__section">
      <h3 className="dep-tree__heading">
        {title} <span className="dep-tree__count">{deps.length}</span>
      </h3>
      <ul className="dep-tree__list">
        {deps.map((d) => (
          <li key={d.name} className="dep-tree__item">
            <span className="dep-tree__name">{d.name}</span>
            {d.version && (
              <span className="dep-tree__version">{d.version}</span>
            )}
            {d.features && d.features.length > 0 && (
              <span className="dep-tree__features">
                {d.features.map((f) => (
                  <span key={f} className="dep-tree__feature">
                    {f}
                  </span>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default DepList;
