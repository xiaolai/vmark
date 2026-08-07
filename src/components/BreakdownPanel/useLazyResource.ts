/**
 * useLazyResource — fetch a resource when a disclosure opens, keyed so a
 * changed key never shows the previous key's data.
 *
 * Replaces two hand-rolled lazy loaders (the anchor picker's headings, the
 * logbook) that each cached for the component's lifetime with no key. That
 * produced two audit findings: switching workspace kept showing the old
 * workspace's data (and blocked a refetch), and a late response from a
 * superseded fetch could overwrite the current one.
 *
 * Design:
 * - **Fetch on each open, no lifetime cache.** The fetch reads the ledger,
 *   which is acceptable on an explicit expand and is also how data that went
 *   stale after a mutation gets refreshed — a lifetime cache showed obsolete
 *   M2/heading data for the rest of the panel's life. The fetch is kicked off
 *   from the toggle EVENT handler, not an effect, so it never triggers the
 *   cascading-setState-in-effect footgun.
 * - **Key-scoped.** A changed `key` (workspace switch, different edge) resets
 *   data and collapses the disclosure, done with the sanctioned
 *   adjust-state-during-render pattern rather than an effect.
 * - **Stale-response guarded.** Each load captures the key it started under; a
 *   response is applied only while that key is still current, so a slow earlier
 *   fetch can never overwrite a newer key's data.
 *
 * `key === null` means "not fetchable yet" (e.g. no workspace) — toggling still
 * opens/closes but never fetches.
 *
 * @module components/BreakdownPanel/useLazyResource
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface LazyResource<T> {
  open: boolean;
  toggle: () => void;
  data: T | null;
  loading: boolean;
}

export function useLazyResource<T>(
  key: string | null,
  fetcher: () => Promise<T | null>,
): LazyResource<T> {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeKey, setActiveKey] = useState(key);

  // Two guards against a stale response overwriting fresh data:
  // - `currentKey` (mirrored in an effect) drops a response whose key has since
  //   changed — cross-key staleness.
  // - `gen` is bumped by every `load`, so a SAME-key response that resolves out
  //   of order (open→close→open before the first fetch returns) is dropped too:
  //   only the newest generation may apply. Bumped inside `load`, an event
  //   handler, so no ref is written during render.
  const currentKey = useRef(key);
  const gen = useRef(0);
  useEffect(() => {
    currentKey.current = key;
  }, [key]);

  // Adjust state when the key changes — React's storing-info-from-previous-render
  // pattern, so a new key never inherits the old one's data or open state.
  if (key !== activeKey) {
    setActiveKey(key);
    setOpen(false);
    setData(null);
    setLoading(false);
  }

  const load = useCallback(() => {
    if (key === null) return;
    const startKey = key;
    const g = ++gen.current;
    const fresh = () => gen.current === g && currentKey.current === startKey;
    setData(null);
    setLoading(true);
    void fetcher()
      .then((r) => {
        if (fresh()) setData(r);
      })
      .finally(() => {
        if (fresh()) setLoading(false);
      });
  }, [key, fetcher]);

  const toggle = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    load(); // fetch on each open — no lifetime cache to go stale
  }, [open, load]);

  return { open, toggle, data, loading };
}
