import { AxiosError } from "axios";

export function textReply(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    ...(isError ? { isError: true as const } : {}),
  };
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    return error.response?.data?.message ?? error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// get_home_stats rows share one shape across very different category types
// (media titles, users, platforms, libraries, a synthetic "concurrent
// streams" row), so the field that actually identifies each row - and its
// play count - varies by category rather than by which fields happen to be
// populated on any given row.
export function rowLabel(statId: string, item: any): string {
  switch (statId) {
    case "top_users":
      return item.friendly_name || item.user || item.username || "Unknown";
    case "top_platforms":
      return item.platform || item.platform_name || "Unknown";
    case "top_libraries":
      return item.section_name || item.library_name || "Unknown";
    case "most_concurrent":
      return item.title || "Unknown";
    default:
      // top_movies, popular_movies, top_tv, popular_tv, top_music,
      // popular_music, last_watched - the media title, not who watched it.
      return item.grandparent_title || item.title || "Unknown";
  }
}

export function rowPlays(item: any): number {
  return item.total_plays ?? item.play_count ?? item.count ?? 0;
}

// Escapes text for use inside a Markdown table cell. Backslashes first, then
// pipes: escaping only the pipe would let a trailing "\\" cancel the pipe's
// escape and break the row (CodeQL js/incomplete-sanitization).
export function escapeTableCell(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

