import { debounce } from "./debounce";

const SEARCH_COUNT_DEBOUNCE_MS = 300;

type CountCallback = (
  content: string,
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
  useRegex: boolean
) => void;

export function createDebouncedSearchCounter(callback: CountCallback) {
  const debounced = debounce(callback, SEARCH_COUNT_DEBOUNCE_MS);

  return {
    schedule(...args: Parameters<CountCallback>) {
      debounced(...args);
    },
    cancel() {
      debounced.cancel();
    },
  };
}
