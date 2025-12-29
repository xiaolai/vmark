/**
 * Date Utilities
 *
 * Shared date formatting functions for consistent display across the app.
 */

/**
 * Check if a date is today
 */
export function isToday(date: Date): boolean {
  return date.toDateString() === new Date().toDateString();
}

/**
 * Check if a date is yesterday
 */
export function isYesterday(date: Date): boolean {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return date.toDateString() === yesterday.toDateString();
}

/**
 * Format a timestamp as relative time (e.g., "5s ago", "2m ago")
 */
export function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/**
 * Format a timestamp as exact time (e.g., "2:30:45 PM")
 */
export function formatExactTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

/**
 * Format a timestamp for display in history (e.g., "Today 2:30 PM", "Yesterday 10:00 AM")
 */
export function formatSnapshotTime(timestamp: number): string {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (isToday(date)) return `Today ${time}`;
  if (isYesterday(date)) return `Yesterday ${time}`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Get a day label for grouping (e.g., "Today", "Yesterday", "Monday, Dec 25")
 */
export function getDayLabel(date: Date): string {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/**
 * Group items by day using a timestamp accessor
 */
export function groupByDay<T>(
  items: T[],
  getTimestamp: (item: T) => number
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const date = new Date(getTimestamp(item));
    const key = getDayLabel(date);

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(item);
  }

  return groups;
}
