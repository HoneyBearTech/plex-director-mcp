# The Query chat

The **Query** page, the first in the sidebar, answers questions about your movie and TV library in plain
words: "Do I have the F1 movie?", "Which shows do I own with Bryan Cranston?", "What's on this week?". Claude
reads the question, uses Plex Director's tools to look things up, and answers in a sentence or two, with the
titles it found in a table below.

It needs `ANTHROPIC_API_KEY` set on the server ([installing.md](../installing.md#container-settings)). Without
it, asking anything shows the error *ANTHROPIC_API_KEY is not configured on the server.* The rest of the
dashboard works without it.

## Asking

Type a question and press Enter or **Ask**. While Claude works, the chat shows *Thinking…*; a question that
needs several look-ups can take a few seconds.

**Follow-ups keep the context.** After "Which Harrison Ford movies do I have?", you can ask "which of those are
in 4K?" or "only the ones from the 80s". Claude repeats the search with the extra filter, so the new table is
complete rather than a guess. **New chat** clears the conversation and starts over.

The conversation lives only in that browser tab: reloading the page or opening another one starts a new chat.
Nothing of it is saved on the server.

## The results table

When a search returns titles, they appear in a table under the answer, with a poster for each, its year, and
the Plex libraries that hold it (or *Not in Plex*). Depending on the question it also shows:

- for shows, the seasons and episodes, with a bar for how many you have watched (Plex) or how many are
  downloaded (Sonarr);
- the genres, or the role an actor played;
- when you last watched it, or when it was added;
- its audience rating.

A movie held in both an HD and a 4K library is one row, with both libraries. The first 50 rows are shown, with a
button to show the rest. A new search replaces the table; asking for "the rest" of a long result adds to it.

## What it can and can't do

The chat uses the twelve read-only tools for your library, movies and TV, the ones marked ★ in the
[README](../../README.md#mcp-tools):

- [your library](library.md): `search_plex_library`, `search_episodes`, `get_on_deck`,
  `resolve_actor_filmography`;
- [movies](movies.md): `check_movie_status`, `diagnose_missing_media`;
- [TV](tv.md): `check_series_completeness`, `find_series_gaps`, `find_series_by_quality`, `check_series_status`,
  `diagnose_missing_episodes`, `get_upcoming_episodes`.

It **can't change anything**: it can't add movies, touch the download queues, run jobs or backups, or check
indexers and hosts. Use Claude Desktop for those, or the dashboard's other pages to look at them.

Each question may take up to four rounds of tool calls. If Claude still hasn't finished, it says it hit its
tool-call limit; asking a narrower question usually helps.

## What leaves your network

Your question, the recent conversation (up to the last 12 messages, each cut to 4,000 characters, plus a short
list of the titles in each earlier table) and the results of the tools Claude uses are sent to the Anthropic API,
using your key and billed to it. Tool results can include titles, file paths and posters from your services.
API keys and tokens are never part of them.
